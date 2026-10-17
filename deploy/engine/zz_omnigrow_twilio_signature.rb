# frozen_string_literal: true

# OmniGrow hardening for the messaging engine (Chatwoot 4.18.0).
#
# Chatwoot does not validate Twilio's X-Twilio-Signature on inbound SMS/WhatsApp callbacks, so anyone
# who knows a public Account SID and business number can inject messages. This initializer is mounted
# read-only into the engine containers (see compose.yaml) and rejects callbacks whose signature does
# not verify against the channel's auth token, using the twilio-ruby gem the engine already ships.
# Rails rebuilds request.original_url from Caddy's forwarded Host and protocol, which is the public
# https URL Twilio signed.
module OmniGrowTwilioSignature
  extend ActiveSupport::Concern

  included do
    before_action :verify_twilio_signature!
  end

  private

  def verify_twilio_signature!
    channel = omnigrow_twilio_channel
    signature = request.headers['X-Twilio-Signature'].to_s
    valid = channel.present? && signature.present? &&
            ::Twilio::Security::RequestValidator.new(channel.auth_token.to_s)
                                                .validate(request.original_url, request.request_parameters, signature)
    return if valid

    Rails.logger.warn(
      "[OmniGrow] Rejected Twilio callback without a valid signature path=#{request.path} " \
      "channel_found=#{channel.present?} signature_present=#{signature.present?} remote_ip=#{request.remote_ip}"
    )
    head :forbidden
  end

  def omnigrow_twilio_channel
    sid = params[:MessagingServiceSid].presence
    found = ::Channel::TwilioSms.find_by(messaging_service_sid: sid) if sid
    return found if found

    # Inbound messages address the business number in To; delivery statuses report it in From.
    number = params[:To].presence || params[:From].presence
    return if params[:AccountSid].blank? || number.blank?

    ::Channel::TwilioSms.find_by(account_sid: params[:AccountSid], phone_number: number) ||
      ::Channel::TwilioSms.find_by(account_sid: params[:AccountSid], phone_number: params[:From].presence)
  end
end

Rails.application.config.to_prepare do
  [::Twilio::CallbackController, ::Twilio::DeliveryStatusController].each do |controller|
    controller.include(OmniGrowTwilioSignature) unless controller < OmniGrowTwilioSignature
  end
end
