require 'time'
require 'date'

module OmniGrow
  module SubscriptionTerms
    # Price exponents are explicit; zero/three-decimal currencies must never be
    # silently treated as cents. Prices are records, not card charges.
    CURRENCIES = { 'USD' => 2, 'EUR' => 2, 'GBP' => 2, 'EGP' => 2, 'AED' => 2, 'SAR' => 2, 'INR' => 2, 'CAD' => 2, 'AUD' => 2, 'JPY' => 0, 'KWD' => 3, 'BHD' => 3, 'OMR' => 3 }.freeze

    def subscription_access_until
      subscription_paid_through && subscription_paid_through + subscription_grace_days.days
    end
    def subscription_status(now = Time.current)
      return 'cancelled' if subscription_state == 'cancelled'
      return 'unlimited' if subscription_interval == 'unlimited'
      return 'scheduled' if now < subscription_anchor_at
      return 'active' if now < subscription_paid_through
      return 'grace' if now < subscription_access_until
      'expired'
    end
    def subscription_available?(now = Time.current) = %w[unlimited active grace].include?(subscription_status(now))
    def access_enabled? = account.active? && subscription_available?
    def require_subscription!
      raise Error.new('This business subscription is inactive. Contact your service provider to activate or renew it.', 402) unless subscription_available?
    end
    def subscription_payload(financial: false)
      result = { interval: subscription_interval, status: subscription_status, starts_at: subscription_anchor_at,
                 paid_through: subscription_paid_through, access_until: subscription_access_until,
                 grace_days: subscription_grace_days, version: subscription_version, collection: 'manual' }
      result.merge!(amount_minor: subscription_amount_minor, currency: subscription_currency,
                    currency_exponent: CURRENCIES.fetch(subscription_currency)) if financial
      result
    end
  end
  Business.include(SubscriptionTerms) unless Business < SubscriptionTerms

  class SubscriptionChange < ApplicationRecord
    self.table_name = 'og_subscription_changes'
    def payload = attributes.slice('id', 'actor_id', 'action', 'reference', 'terms', 'created_at')
  end

  module Subscriptions
    module_function
    def apply!(business, user, input)
      values = input.to_h.stringify_keys.slice('operation', 'interval', 'starts_at', 'amount_minor', 'currency', 'grace_days', 'reference', 'version', 'client_id')
      key = values['client_id'].to_s.downcase
      raise Error, 'A valid unique subscription action ID is required.' unless /\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/.match?(key)
      digest = Digest::SHA256.hexdigest(JSON.generate([user.id, values.except('client_id').sort.to_h]))
      replayed = false
      business.with_lock do
        previous = SubscriptionChange.find_by(account_id: business.account_id, client_id: key)
        if previous
          raise Error.new('This action ID was already used for different subscription details.', 409) unless previous.request_digest == digest
          replayed = true
          next
        end
        raise Error.new('The subscription changed. Refresh its details before trying again.', 409) unless integer(values['version']) == business.subscription_version
        reference = values['reference'].to_s.strip
        raise Error, 'Enter a payment, contract or adjustment reference (1–200 characters).' unless (1..200).cover?(reference.length) && !reference.match?(/[\x00-\x1f\x7f]/)
        action = values['operation']
        if %w[activate renew].include?(action) && SubscriptionChange.where(account_id: business.account_id, action: %w[activate renew]).where('lower(reference) = ?', reference.downcase).exists?
          raise Error.new('This payment reference is already recorded for this business. Check the subscription history before renewing again.', 409)
        end
        now = Time.current
        case action
        when 'activate'
          interval = values['interval'].to_s
          raise Error, 'Choose a monthly or yearly term.' unless %w[monthly yearly].include?(interval)
          start = timestamp(values['starts_at'])
          amount, grace = integer(values['amount_minor']), integer(values['grace_days'])
          currency = values['currency'].to_s.upcase
          raise Error, 'Enter a valid amount, supported currency and grace period of 0–30 days.' unless amount.between?(0, 1_000_000_000_000) && grace.between?(0, 30) && SubscriptionTerms::CURRENCIES.key?(currency)
          business.assign_attributes(subscription_interval: interval, subscription_state: 'enabled', subscription_anchor_at: start,
                                     subscription_cycles: 1, subscription_paid_through: end_of_term(start, interval, 1),
                                     subscription_amount_minor: amount, subscription_currency: currency, subscription_grace_days: grace)
        when 'renew'
          raise Error, 'Activate a monthly or yearly term before renewing.' if business.subscription_interval == 'unlimited'
          # Preserve the original calendar anchor across short months/leap years.
          # An expired/cancelled lease starts a new paid period from renewal time.
          if business.subscription_available?(now) || business.subscription_status(now) == 'scheduled'
            cycles = business.subscription_cycles + 1
            raise Error, 'Activate a new term after 1,200 periods.' if cycles > 1200
            business.subscription_cycles = cycles
          else
            business.subscription_anchor_at = now
            business.subscription_cycles = 1
          end
          business.subscription_state = 'enabled'
          business.subscription_paid_through = end_of_term(business.subscription_anchor_at, business.subscription_interval, business.subscription_cycles)
        when 'unlimited'
          business.assign_attributes(subscription_interval: 'unlimited', subscription_state: 'enabled', subscription_anchor_at: nil,
                                     subscription_paid_through: nil, subscription_cycles: 0, subscription_grace_days: 0, subscription_amount_minor: 0)
        when 'cancel'
          business.subscription_state = 'cancelled'
        else
          raise Error, 'Choose activate, renew, unlimited or cancel.'
        end
        unless business.subscription_available?(now)
          Meeting.active.where(account_id: business.account_id).find_each { |meeting| Meetings.end!(meeting) }
        end
        business.subscription_version += 1
        business.save!
        SubscriptionChange.create!(account_id: business.account_id, actor_id: user.id, client_id: key, request_digest: digest,
                                   action: action, reference: reference, terms: business.subscription_payload(financial: true), created_at: now)
        Audit.record(business.account, user, "subscription.#{action}", { version: business.subscription_version, paid_through: business.subscription_paid_through })
      end
      { business: business.payload(financial: true), replayed: replayed }
    end
    def integer(value)
      raise Error, 'Enter whole-number subscription values.' unless /\A\d{1,13}\z/.match?(value.to_s)
      Integer(value.to_s, 10)
    end
    def timestamp(value)
      parts = value.to_s.match(/\A(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))\z/)
      raise ArgumentError unless parts
      year, month, day, hour, minute, second, offset_hour, offset_minute = parts.captures.map { |part| part ? Integer(part, 10) : 0 }
      raise ArgumentError unless Date.valid_date?(year, month, day) && hour.between?(0, 23) && minute.between?(0, 59) && second.between?(0, 59)
      raise ArgumentError unless offset_hour.between?(0, 14) && offset_minute.between?(0, 59) && (offset_hour != 14 || offset_minute.zero?)
      time = Time.iso8601(value).utc
      raise ArgumentError unless time.year.between?(2000, 2100)
      time
    rescue ArgumentError
      raise Error, 'Choose a valid subscription start date with a timezone.'
    end
    def end_of_term(anchor, interval, cycles) = anchor.advance(months: cycles * (interval == 'yearly' ? 12 : 1))
  end

  class SubscriptionExpiryJob < ApplicationJob
    queue_as :critical
    def perform
      # Request authorization evaluates the clock directly. This job terminates
      # already-connected calls, and retries on subsequent scheduled sweeps.
      Business.where(account_id: Meeting.active.select(:account_id)).find_each do |business|
        business.with_lock do
          next if business.access_enabled?
          Meeting.active.where(account_id: business.account_id).find_each { |meeting| Meetings.end!(meeting) }
        end
      rescue StandardError => error
        Rails.logger.error("OmniGrow subscription meeting cleanup failed account=#{business.account_id} type=#{error.class.name}")
      end
    end
  end
end

if Sidekiq.server?
  Sidekiq::Cron::Job.create(name: 'omnigrow_subscription_expiry', cron: '* * * * *', class: 'OmniGrow::SubscriptionExpiryJob', active_job: true, queue: 'critical', source: 'dynamic')
end
