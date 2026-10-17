module OmniGrow
  class OperatorController < Api::BaseController
    before_action :operator!
    rescue_from OmniGrow::Error do |error|
      render json: { error: error.message }, status: error.status
    end
    rescue_from ActiveRecord::RecordInvalid do |error|
      render json: { error: error.record.errors.full_messages.join('. ').truncate(400) }, status: :unprocessable_entity
    end
    def index
      scope = Business.includes(:account).order(account_id: :desc)
      scope = scope.where('account_id < ?', params[:before].to_i) if params[:before].present?
      list = scope.limit(100).to_a
      render json: { businesses: list.map { |business| business.payload(financial: true) }, has_more: list.length == 100 }
    end
    def create
      business, invitation, token = nil
      key = params[:client_id].to_s.downcase
      raise Error, 'A valid unique creation ID is required.' unless /\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/.match?(key)
      attrs = package_params
      digest = Digest::SHA256.hexdigest(JSON.generate([params[:name], params[:owner_email], params[:owner_name], attrs]))
      Business.transaction do
        # Serialize retries before an account exists to lock. No user input is
        # interpolated into SQL; the signed integer is derived from SHA-256.
        lock_id = Digest::SHA256.digest(key).unpack1('q>')
        Business.connection.execute("SELECT pg_advisory_xact_lock(#{lock_id})")
        business = Business.find_by(provisioning_key: key)
        if business
          raise Error.new('This creation ID was already used for different details.', 409) unless business.provisioning_digest == digest
        else
          name = params[:name].to_s.strip
          raise Error, 'Enter a business name of 1–100 characters.' unless (1..100).cover?(name.length)
          account = Account.create!(name: name)
          business = Business.create!(account: account, provisioning_key: key, provisioning_digest: digest, **attrs)
          invitation, token = Invitation.issue!(account: account, email: params[:owner_email], name: params[:owner_name], role: 'administrator')
          Audit.record(account, current_user, 'business.created', { plan: business.plan })
        end
      end
      render json: { business: business.payload(financial: true), invitation: invitation&.public_payload, token: token, replayed: invitation.nil? }, status: :created
    end
    def update
      business = Business.find_by!(account_id: params[:id])
      business.with_lock do
        attrs = package_params
        raise Error, 'The seat limit cannot be lower than current employees and pending invitations.' if attrs[:seat_limit] < business.used_seats
        raise Error, 'The storage limit cannot be lower than stored documents.' if attrs[:storage_limit_bytes] < business.used_storage
        status = params[:status].to_s
        raise Error, 'Choose active or suspended.' unless %w[active suspended].include?(status)
        if status == 'suspended' || (business.team? && attrs[:plan] == 'inbox')
          Meeting.active.where(account_id: business.account_id).each { |meeting| Meetings.end!(meeting) }
        end
        business.update!(attrs)
        business.account.update!(status: status)
        Audit.record(business.account, current_user, 'business.package_updated', { plan: business.plan, status: status, seat_limit: business.seat_limit, storage_limit_bytes: business.storage_limit_bytes })
      end
      render json: business.payload(financial: true)
    end
    def subscription
      business = Business.find_by!(account_id: params[:id])
      changes = SubscriptionChange.where(account_id: business.account_id).order(id: :desc).limit(50)
      render json: { business: business.payload(financial: true), changes: changes.map(&:payload) }
    end
    def change_subscription
      business = Business.find_by!(account_id: params[:id])
      render json: Subscriptions.apply!(business, current_user, params.permit(:operation, :interval, :starts_at, :amount_minor, :currency, :grace_days, :reference, :version, :client_id))
    end
    def invite
      business = Business.find_by!(account_id: params[:id])
      invitation, token = nil
      business.with_lock do
        raise Error, 'Activate this business before inviting an administrator.' unless business.account.active?
        invitation, token = Invitation.issue!(account: business.account, email: params[:email], name: params[:name], role: 'administrator')
        Audit.record(business.account, current_user, 'administrator.invited', { invitation_id: invitation.id })
      end
      render json: { invitation: invitation.public_payload, token: token }, status: :created
    end
    private
    def operator!
      raise Error.new('Only the installation operator can manage businesses.', 403) unless current_user.is_a?(SuperAdmin)
      response.headers['Cache-Control'] = 'private, no-store'
    end
    def package_params
      { plan: params[:plan].to_s, seat_limit: Integer(params[:seat_limit]), storage_limit_bytes: Integer(params[:storage_limit_bytes]) }
    rescue ArgumentError, TypeError
      raise Error, 'Enter valid seat and storage limits.'
    end
  end

  class InvitationsController < ApplicationController
    rescue_from OmniGrow::Error do |error|
      render json: { error: error.message }, status: error.status
    end
    rescue_from ActiveRecord::RecordInvalid do |error|
      # Devise's password policy messages name the missing character type or the rejected
      # character so the person who typed the password can correct it; nothing else is echoed.
      render json: { error: error.record.errors.full_messages.join('. ').truncate(400) }, status: :unprocessable_entity
    end
    before_action :find_invitation
    def preview
      existing = User.where('lower(email) = ?', @invitation.email).exists?
      render json: { business_name: @invitation.account.name, email: @invitation.email, name: @invitation.name, role: @invitation.role,
                     existing_user: existing, signed_in_as_invitee: current_user&.email&.downcase == @invitation.email, expires_at: @invitation.expires_at }
    end
    def accept
      user = nil
      business = Business.find_by!(account_id: @invitation.account_id)
      business.with_lock do
        @invitation.reload
        valid_invitation!
        user = User.where('lower(email) = ?', @invitation.email).first
        if user
          # Users are global identities. Possessing a business invitation never
          # authorizes changing an existing user's password, MFA or other tenants.
          raise Error.new('Sign in with the invited email address before accepting.', 401) unless current_user&.id == user.id
        else
          password = params[:password].to_s
          raise Error, 'Use a password of 12–128 characters.' unless (12..128).cover?(password.length)
          user = User.new(email: @invitation.email, name: @invitation.name, password: password)
          user.skip_confirmation!
          user.save!
        end
        unless AccountUser.exists?(account_id: @invitation.account_id, user_id: user.id)
          raise Error, 'This business has reached its employee limit.' if business.account.account_users.count >= business.seat_limit
          AccountUser.create!(account: business.account, user: user, role: @invitation.role)
        end
        @invitation.update!(accepted_at: Time.current)
        Audit.record(business.account, user, 'invitation.accepted', { invitation_id: @invitation.id })
      end
      render json: { accepted: true, email: user.email, account_id: business.account_id }
    end
    private
    def find_invitation
      response.headers['Cache-Control'] = 'private, no-store'
      token = params[:token].to_s
      raise Error.new('This invitation is invalid or expired.', 410) unless /\A[A-Za-z0-9_-]{43}\z/.match?(token)
      @invitation = Invitation.find_by(token_digest: Digest::SHA256.hexdigest(token))
      valid_invitation!
    end
    def valid_invitation!
      raise Error.new('This invitation is invalid, expired or already used.', 410) unless @invitation && !@invitation.accepted_at && !@invitation.revoked_at && @invitation.expires_at > Time.current && @invitation.account.active?
    end
  end

  class MeetingWebhooksController < ActionController::API
    def create
      raise OmniGrow::Error.new('Invalid webhook.', 401) unless Meetings.configured? && request.content_length.to_i <= 65536
      raw = request.raw_post
      raise OmniGrow::Error.new('Invalid webhook.', 401) if raw.bytesize > 65536
      token = request.headers['Authorization'].to_s.delete_prefix('Bearer ')
      claims, = JWT.decode(token, ENV.fetch('OG_MEETING_API_SECRET'), true, { algorithms: ['HS256'], verify_iss: true, iss: ENV.fetch('OG_MEETING_API_KEY') })
      digest = Base64.strict_encode64(Digest::SHA256.digest(raw))
      raise OmniGrow::Error.new('Invalid webhook.', 401) unless ActiveSupport::SecurityUtils.secure_compare(claims.fetch('sha256', ''), digest)
      event = JSON.parse(raw)
      if event['event'] == 'room_finished'
        meeting = Meeting.find_by(room_name: event.dig('room', 'name'))
        if meeting && !meeting.ended_at
          meeting.update!(ended_at: Time.current)
          meeting.room.emit('team.meeting')
        end
      end
      head :ok
    rescue JWT::DecodeError, JSON::ParserError, OmniGrow::Error, KeyError
      head :unauthorized
    end
  end
end
