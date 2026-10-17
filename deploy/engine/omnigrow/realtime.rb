module OmniGrow
  module RealtimeAccess
    def update_presence
      if current_user.is_a?(User) && !omnigrow_active_membership(params[:account_id])
        stop_all_streams
        reject
        return
      end
      super
    end
    private
    def ensure_stream
      return super unless current_user.is_a?(User)
      unless omnigrow_active_membership(params[:account_id])
        reject
        return
      end
      # Filter at delivery, not just subscription: a queued native broadcast or
      # a socket opened before suspension/downgrade must not retain access.
      [pubsub_token, "account_#{@current_account.id}"].each do |broadcasting|
        stream_from(broadcasting, coder: ActiveSupport::JSON) { |payload| omnigrow_transmit(payload) }
      end
    end
    def omnigrow_active_membership(account_id)
      member = AccountUser.includes(:account).find_by(account_id: account_id, user_id: current_user.id)
      member if member&.account&.active?
    end
    def omnigrow_transmit(payload)
      return unless payload.is_a?(Hash) && payload['data'].is_a?(Hash)
      account_id = payload['data']['account_id']
      return unless account_id.to_s == params[:account_id].to_s
      member = omnigrow_active_membership(account_id)
      return unless member
      business = OmniGrow::Business.find_by(account_id: account_id) if OmniGrow::Business.table_exists?
      event = payload['event'].to_s
      if event.start_with?('team.')
        return unless business&.team? && OmniGrow::Room.visible(member.account, current_user).where(id: payload['data']['room_id']).exists?
      elsif event != 'presence.update'
        return if business && !business.inbox?
      end
      transmit(payload)
    rescue ActiveRecord::RecordNotFound
      stop_all_streams
      reject
    end
  end
end
RoomChannel.prepend(OmniGrow::RealtimeAccess) unless RoomChannel < OmniGrow::RealtimeAccess
