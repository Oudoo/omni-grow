require 'jwt'
require 'net/http'
require 'base64'
module OmniGrow
  module Meetings
    module_function
    def configured?
      %w[OG_MEETING_URL OG_MEETING_INTERNAL_URL OG_MEETING_API_KEY OG_MEETING_API_SECRET].all? { |key| ENV[key].present? }
    end
    def jwt(claims, ttl = 60)
      now = Time.now.to_i
      JWT.encode({ iss: ENV.fetch('OG_MEETING_API_KEY'), iat: now, nbf: now - 5, exp: now + ttl }.merge(claims), ENV.fetch('OG_MEETING_API_SECRET'), 'HS256')
    end
    def rpc(method, body, grant)
      raise Error.new('Meetings are not configured. Ask the operator to start the meeting service.', 503) unless configured?
      base = URI(ENV.fetch('OG_MEETING_INTERNAL_URL'))
      raise Error.new('The meeting service address is invalid.', 503) unless %w[http https].include?(base.scheme) && base.host.present? && !base.userinfo
      target = URI.join(base.to_s, "/twirp/livekit.RoomService/#{method}")
      request = Net::HTTP::Post.new(target)
      request['Content-Type'] = 'application/json'
      request['Authorization'] = "Bearer #{jwt({ video: grant })}"
      request.body = JSON.generate(body)
      # This operator-configured private service must never inherit HTTP_PROXY:
      # routing its signed administrative requests through an outbound proxy
      # both breaks Docker DNS and discloses the service capability.
      response = Net::HTTP.start(target.host, target.port, nil, use_ssl: target.scheme == 'https', open_timeout: 3, read_timeout: 5) { |http| http.request(request) }
      return {} if method == 'DeleteRoom' && response.code == '404'
      raise Error.new('The meeting service could not complete this action. Retry when it is available.', 503) unless response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body.presence || '{}')
    rescue SocketError, IOError, SystemCallError, Timeout::Error, JSON::ParserError
      raise Error.new('The meeting service is unavailable. Please retry.', 503)
    end
    # auto_create=false is mandatory in the SFU configuration. Ending a room
    # deletes its immutable incarnation; a still-unexpired JWT cannot recreate it.
    def start!(room, user)
      active = room.meetings.active.first
      # Reconcile all stale rows before enforcing the business-wide limit.
      live = rpc('ListRooms', {}, { roomList: true }).fetch('rooms', []).map { |item| item['name'] }
      Meeting.active.where(account_id: room.account_id).where.not(room_name: live).update_all(ended_at: Time.current)
      return active if active && live.include?(active.room_name)
      raise Error, 'This business already has ten active meetings.' if Meeting.active.where(account_id: room.account_id).count >= 10
      name = "og_#{room.account_id}_#{SecureRandom.uuid}"
      rpc('CreateRoom', { name: name, empty_timeout: 300, departure_timeout: 30, max_participants: 50 }, { roomCreate: true })
      room.meetings.create!(account_id: room.account_id, user: user, room_name: name)
    rescue ActiveRecord::ActiveRecordError
      rpc('DeleteRoom', { room: name }, { roomCreate: true }) if name
      raise
    end
    def end!(meeting)
      return if meeting.ended_at
      rpc('DeleteRoom', { room: meeting.room_name }, { roomCreate: true })
      meeting.update!(ended_at: Time.current)
      meeting.room.emit('team.meeting')
    end
    def end_for_user!(account, user_id)
      rooms = Room.visible(account, User.find(user_id)).select(:id)
      Meeting.active.where(account_id: account.id, room_id: rooms).find_each { |meeting| end!(meeting) }
    end
    def admission(meeting, user)
      # Business lock is held by the caller. Access removals end affected rooms
      # before committing; token issuance cannot race past that boundary.
      raise Error.new('This meeting has ended.', 410) if meeting.ended_at
      live = rpc('ListRooms', { names: [meeting.room_name] }, { roomList: true })
      unless live.fetch('rooms', []).any? { |room| room['name'] == meeting.room_name }
        meeting.update!(ended_at: Time.current)
        return nil # Caller raises only after its lock transaction commits.
      end
      identity = "u#{user.id}-#{SecureRandom.hex(8)}"
      token = jwt({ sub: identity, name: user.name, video: { roomJoin: true, room: meeting.room_name, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false } })
      { token: token, url: ENV.fetch('OG_MEETING_URL'), meeting: meeting.payload, identity: identity }
    end
  end
end
