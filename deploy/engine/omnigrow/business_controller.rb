module OmniGrow
  class BusinessController < Api::V1::Accounts::BaseController
    before_action :business_context
    before_action :require_team, except: %i[context branding logo members invite revoke_invite update_member remove_member audit]
    rescue_from OmniGrow::Error, with: :business_error
    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: 'This item is unavailable in your business.' }, status: :not_found
    end
    rescue_from ActiveRecord::RecordInvalid do |error|
      render json: { error: error.record.errors.full_messages.join('. ').truncate(400) }, status: :unprocessable_entity
    end
    rescue_from ActiveRecord::RecordNotUnique do
      render json: { error: 'This action conflicts with a recent change. Refresh and retry.' }, status: :conflict
    end

    def context
      render json: { business: @business.payload, administrator: administrator?, operator: current_user.is_a?(SuperAdmin), meetings_configured: Meetings.configured? }
    end
    def branding
      admin!
      business_lock do
        name = params[:name].to_s.strip
        raise Error, 'Enter a business name of 1–100 characters.' unless (1..100).cover?(name.length)
        website = params[:website].to_s.strip
        raise Error, 'The website must be an HTTPS address.' unless website.empty? || (URI(website).scheme == 'https' && URI(website).host.present? && !URI(website).userinfo)
        Current.account.update!(name: name)
        @business.update!(description: params[:description].to_s, website: website, accent_color: params[:accent_color].to_s)
        if params[:logo].present?
          upload = params[:logo]
          validate_upload!(upload, 2 * 1024**2)
          bytes = upload.tempfile.read(12)
          upload.tempfile.rewind
          type = if bytes.start_with?("\x89PNG\r\n\x1a\n".b) then 'image/png'
                 elsif bytes.start_with?("\xff\xd8\xff".b) then 'image/jpeg'
                 elsif bytes.start_with?('RIFF') && bytes[8, 4] == 'WEBP' then 'image/webp'
                 end
          raise Error, 'Use a PNG, JPEG or WebP logo.' unless type
          @business.logo.attach(io: upload.tempfile, filename: "logo.#{type.split('/').last}", content_type: type, identify: false)
        elsif params[:remove_logo] == true || params[:remove_logo] == 'true'
          @business.logo.purge_later
        end
        Audit.record(Current.account, current_user, 'business.branding_updated')
      end
      render json: @business.reload.payload
    rescue URI::InvalidURIError
      raise Error, 'The website must be an HTTPS address.'
    end
    def logo
      raise ActiveRecord::RecordNotFound unless @business.logo.attached?
      send_data @business.logo.download, type: @business.logo.blob.content_type, disposition: 'inline', filename: @business.logo.filename.to_s
    end
    def members
      people = Current.account.account_users.includes(:user).order(:id).map do |member|
        { id: member.user_id, name: member.user.name, email: member.user.email, role: member.role }
      end
      render json: { members: people, invitations: administrator? ? Invitation.pending.where(account_id: Current.account.id).order(id: :desc).map(&:public_payload) : [] }
    end
    def invite
      admin!
      invitation, token = nil
      business_lock do
        invitation, token = Invitation.issue!(account: Current.account, email: params[:email], name: params[:name], role: params[:role].presence || 'agent')
        Audit.record(Current.account, current_user, 'member.invited', { invitation_id: invitation.id })
      end
      render json: { invitation: invitation.public_payload, token: token }, status: :created
    end
    def revoke_invite
      admin!
      business_lock do
        invitation = Invitation.where(account_id: Current.account.id, accepted_at: nil).find(params[:id])
        invitation.update!(revoked_at: Time.current)
        Audit.record(Current.account, current_user, 'invitation.revoked', { invitation_id: invitation.id })
      end
      render json: { ok: true }
    end
    def update_member
      admin!
      business_lock do
        member = Current.account.account_users.find_by!(user_id: params[:id])
        raise Error, 'Choose administrator or agent.' unless %w[administrator agent].include?(params[:role])
        preserve_administrator!(member) unless params[:role] == 'administrator'
        member.update!(role: params[:role])
        Audit.record(Current.account, current_user, 'member.role_changed', { user_id: member.user_id, role: member.role })
      end
      render json: { ok: true }
    end
    def remove_member
      admin!
      business_lock do
        member = Current.account.account_users.find_by!(user_id: params[:id])
        preserve_administrator!(member)
        member.destroy!
        Audit.record(Current.account, current_user, 'member.removed', { user_id: member.user_id })
      end
      render json: { ok: true }
    end
    def audit
      admin!
      render json: { events: Audit.where(account_id: Current.account.id).order(id: :desc).limit(100).as_json(only: %i[id actor_id action details created_at]) }
    end

    def rooms
      render json: { rooms: Room.visible(Current.account, current_user).order(updated_at: :desc).limit(500).map { |room| room.payload(current_user) } }
    end
    def show_room
      render json: visible_room!.payload(current_user)
    end
    def create_room
      room = nil
      business_lock do
        raise Error, 'This business has reached the 500 channel limit.' if Room.where(account_id: Current.account.id).count >= 500
        kind = params[:kind].to_s
        raise Error, 'Choose a public channel, private channel or direct message.' unless %w[public private direct].include?(kind)
        ids = member_ids(params[:member_ids]) | [current_user.id]
        raise Error, 'Choose one teammate for a direct message.' if kind == 'direct' && ids.length != 2
        key = kind == 'direct' ? ids.sort.join(':') : nil
        room = Room.find_by(account_id: Current.account.id, direct_key: key) if key
        unless room
          room = Room.create!(account_id: Current.account.id, creator: current_user, name: kind == 'direct' ? 'Direct message' : params[:name].to_s.strip, description: params[:description].to_s, kind: kind, direct_key: key)
          ids.each { |id| room.members.create!(account_id: Current.account.id, user_id: id) }
          Audit.record(Current.account, current_user, 'channel.created', { room_id: room.id, kind: room.kind })
        end
      end
      room.emit
      render json: room.payload(current_user), status: :created
    end
    def update_room
      room = visible_room!
      manage_room!(room)
      raise Error, 'Direct message membership cannot be changed.' if room.kind == 'direct'
      business_lock(room) do
        manage_room!(room)
        if params.key?(:member_ids) && room.kind == 'private'
          ids = member_ids(params[:member_ids]) | [current_user.id]
          removed = room.members.pluck(:user_id) - ids
          room.meetings.active.each { |meeting| Meetings.end!(meeting) } if removed.any?
          room.members.where.not(user_id: ids).destroy_all
          ids.each { |id| room.members.find_or_create_by!(account_id: Current.account.id, user_id: id) }
        end
        archived = params[:archived] == true
        room.meetings.active.each { |meeting| Meetings.end!(meeting) } if archived
        attrs = params.permit(:name, :description).to_h
        attrs[:archived_at] = archived ? Time.current : nil if params.key?(:archived)
        room.update!(attrs)
        Audit.record(Current.account, current_user, 'channel.updated', { room_id: room.id })
      end
      room.emit
      render json: room.payload(current_user)
    end
    def messages
      room = visible_room!
      scope = room.messages.includes(:user, documents: [:user, { file_attachment: :blob }])
      scope = scope.where('id < ?', positive_id(params[:before])) if params[:before].present?
      scope = scope.where('id > ?', positive_id(params[:after])) if params[:after].present?
      q = params[:q].to_s.strip.first(200)
      scope = scope.where(deleted_at: nil).where('content ILIKE ?', "%#{Message.sanitize_sql_like(q)}%") if q.present?
      list = params[:after].present? ? scope.order(:id).limit(100).to_a : scope.order(id: :desc).limit(100).to_a.reverse
      render json: { messages: list.map(&:payload), room: room.payload(current_user), has_more: list.length == 100 }
    end
    def create_message
      room = visible_room!
      raise Error, 'This channel is archived.' if room.archived_at
      content = params[:content].to_s.strip
      files = Array(params[:files]).compact
      raise Error, 'Send a message or attach a file.' if content.empty? && files.empty?
      raise Error, 'A message can contain at most five files.' if files.length > 5
      files.each { |file| validate_upload!(file) }
      raise Error, 'Attachments must total no more than 20 MiB.' if files.sum(&:size) > 20 * 1024**2
      attempt = attempt_id!
      parent = params[:reply_to_id].presence && positive_id(params[:reply_to_id])
      room.messages.find(parent) if parent
      digest = Digest::SHA256.hexdigest(JSON.generate([content, parent, files.map { |f| [clean_filename(f.original_filename), Digest::SHA256.file(f.tempfile.path).hexdigest] }]))
      message = nil
      uploaded = []
      committed = false
      business_lock(room) do
        message = room.messages.find_by(user_id: current_user.id, client_id: attempt)
        if message
          raise Error.new('This send ID was already used for different content.', 409) unless message.request_digest == digest
        else
          check_storage!(files.sum(&:size))
          message = room.messages.create!(account_id: Current.account.id, user: current_user, content: content, client_id: attempt, request_digest: digest, reply_to_id: parent)
          files.each_with_index { |file, index| store_document!(room, file, "#{attempt}:#{index}", uploaded, message) }
          room.touch
        end
      end
      committed = true
      room.emit
      render json: message.reload.payload, status: :created
    rescue StandardError
      uploaded&.each { |blob| blob.purge rescue nil } unless committed
      raise
    end
    def change_message
      room = visible_room!
      message = room.messages.find(params[:message_id])
      raise Error.new('Only the author or a business administrator can change this message.', 403) unless message.user_id == current_user.id || administrator?
      business_lock(room) do
        message.reload
        raise Error.new('Only the author or a business administrator can change this message.', 403) unless message.user_id == current_user.id || administrator?
        raise Error, 'This message was deleted.' if message.deleted_at
        if request.delete?
          message.documents.destroy_all
          message.update!(content: '', deleted_at: Time.current)
        else
          content = params[:content].to_s.strip
          raise Error, 'Enter a message.' if content.blank?
          message.update!(content: content, edited_at: Time.current)
        end
        Audit.record(Current.account, current_user, request.delete? ? 'message.deleted' : 'message.edited', { room_id: room.id, message_id: message.id })
      end
      room.emit
      render json: message.payload
    end
    def mark_read
      room = visible_room!
      id = positive_id(params[:message_id])
      business_lock(room) do
        room.messages.find(id)
        read = Read.find_or_create_by!(account_id: Current.account.id, room_id: room.id, user_id: current_user.id)
        read.update!(message_id: [read.message_id, id].max)
      end
      render json: { ok: true }
    end

    def documents
      rooms = Room.visible(Current.account, current_user)
      rooms = rooms.where(id: positive_id(params[:room_id])) if params[:room_id].present?
      scope = Document.where(account_id: Current.account.id, room_id: rooms.select(:id)).includes(:user)
      scope = scope.where('id < ?', positive_id(params[:before])) if params[:before].present?
      q = params[:q].to_s.strip.first(200)
      scope = scope.where('filename ILIKE ?', "%#{Document.sanitize_sql_like(q)}%") if q.present?
      list = scope.order(id: :desc).limit(100).to_a
      render json: { documents: list.map(&:payload), has_more: list.length == 100 }
    end
    def upload_document
      room = visible_room!(params[:room_id])
      raise Error, 'This channel is archived.' if room.archived_at
      file = params[:file]
      validate_upload!(file)
      attempt = attempt_id!
      document = nil
      uploaded = []
      committed = false
      business_lock(room) do
        document = room.documents.find_by(user_id: current_user.id, client_id: attempt)
        if document
          raise Error.new('This upload ID was already used for a different file.', 409) unless document.checksum == Digest::SHA256.file(file.tempfile.path).hexdigest && document.filename == clean_filename(file.original_filename)
        else
          check_storage!(file.size)
          document = store_document!(room, file, attempt, uploaded)
          Audit.record(Current.account, current_user, 'document.uploaded', { room_id: room.id, document_id: document.id })
        end
      end
      committed = true
      room.emit
      render json: document.payload, status: :created
    rescue StandardError
      uploaded&.each { |blob| blob.purge rescue nil } unless committed
      raise
    end
    def download_document
      document = scoped_document!
      # Never disclose a signed ActiveStorage URL, key or blob ID. That would
      # bypass membership checks on the next download via the native blob route.
      send_data document.file.download, type: 'application/octet-stream', disposition: 'attachment', filename: document.filename
    end
    def delete_document
      document = scoped_document!
      raise Error.new('Only the uploader or a business administrator can delete this file.', 403) unless document.user_id == current_user.id || administrator?
      room = document.room
      business_lock(room) do
        document.reload
        raise Error.new('Only the uploader or a business administrator can delete this file.', 403) unless document.user_id == current_user.id || administrator?
        Audit.record(Current.account, current_user, 'document.deleted', { document_id: document.id, room_id: room.id })
        document.destroy!
      end
      room.emit
      render json: { ok: true }
    end

    def start_meeting
      room = visible_room!
      raise Error, 'This channel is archived.' if room.archived_at
      meeting = nil
      business_lock(room) do
        meeting = Meetings.start!(room, current_user)
        Audit.record(Current.account, current_user, 'meeting.started', { meeting_id: meeting.id, room_id: room.id })
      end
      room.emit('team.meeting')
      render json: meeting.payload, status: :created
    end
    def join_meeting
      room = visible_room!
      admission = nil
      business_lock(room) do
        meeting = room.meetings.find(params[:meeting_id])
        admission = Meetings.admission(meeting, current_user)
      end
      raise Error.new('This meeting has ended. Start a new meeting to continue.', 410) unless admission
      render json: admission
    end
    def end_meeting
      room = visible_room!
      business_lock(room) do
        meeting = room.meetings.find(params[:meeting_id])
        raise Error.new('Only the host or a business administrator can end this meeting.', 403) unless meeting.user_id == current_user.id || administrator?
        Meetings.end!(meeting)
        Audit.record(Current.account, current_user, 'meeting.ended', { meeting_id: meeting.id, room_id: room.id })
      end
      render json: { ok: true }
    end

    private

    def business_lock(room = nil)
      @business.with_lock do
        Current.account.reload
        Current.account_user = Current.account.account_users.find_by(user_id: current_user.id)
        raise Error.new('Your business access has been revoked.', 403) unless Current.account.active? && Current.account_user
        admin! if %w[branding invite revoke_invite update_member remove_member].include?(action_name)
        require_team unless %w[branding invite revoke_invite update_member remove_member].include?(action_name)
        if room
          raise ActiveRecord::RecordNotFound unless Room.visible(Current.account, current_user).where(id: room.id).exists?
          room.reload
          raise Error, 'This channel is archived.' if room.archived_at && %w[create_message upload_document start_meeting join_meeting].include?(action_name)
        end
        yield
      end
    end
    def business_context
      raise Error.new('Employee sign-in is required.', 403) unless current_user.is_a?(User) && Current.account_user
      @business = Business.find_or_create_by!(account_id: Current.account.id)
      response.headers['Cache-Control'] = 'private, no-store'
      response.headers['X-Content-Type-Options'] = 'nosniff'
    end
    def business_error(error) = render(json: { error: error.message }, status: error.status)
    def administrator? = Current.account_user.administrator?
    def admin! = (raise Error.new('A business administrator is required.', 403) unless administrator?)
    def require_team = (raise Error.new('Team communications is not included in this business package.', 403) unless @business.team?)
    def positive_id(value)
      raise Error, 'Invalid item ID.' unless /\A[1-9]\d{0,17}\z/.match?(value.to_s)
      value.to_i
    end
    def visible_room!(id = params[:id]) = Room.visible(Current.account, current_user).find(positive_id(id))
    def manage_room!(room) = (raise Error.new('Only the channel creator or an administrator in this channel can manage it.', 403) unless administrator? || room.creator_id == current_user.id)
    def member_ids(value)
      raise Error, 'Choose up to 200 employees.' unless value.is_a?(Array) && value.length <= 200
      ids = value.map { |id| positive_id(id) }.uniq
      raise Error, 'Every participant must belong to this business.' unless Current.account.account_users.where(user_id: ids).count == ids.length
      ids
    end
    def preserve_administrator!(member)
      raise Error, 'A business must keep at least one administrator.' if member.administrator? && Current.account.account_users.where(role: :administrator).count <= 1
    end
    def scoped_document!
      Document.where(account_id: Current.account.id, room_id: Room.visible(Current.account, current_user).select(:id)).find(params[:id])
    end
    def attempt_id!
      value = params[:client_id].to_s
      raise Error, 'A valid unique send ID is required.' unless /\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i.match?(value)
      value.downcase
    end
    def validate_upload!(file, limit = 20 * 1024**2)
      raise Error, 'Choose a nonempty file within the upload size limit.' unless file.is_a?(ActionDispatch::Http::UploadedFile) && file.size.positive? && file.size <= limit
    end
    def clean_filename(name) = File.basename(name.to_s.tr('\\', '/')).gsub(/[\x00-\x1f\x7f]/, '').first(180).presence || 'document'
    def check_storage!(bytes)
      raise Error, 'This business has reached its document storage limit.' if @business.used_storage + bytes > @business.storage_limit_bytes
    end
    def store_document!(room, file, attempt, uploaded, message = nil)
      name = clean_filename(file.original_filename)
      checksum = Digest::SHA256.file(file.tempfile.path).hexdigest
      blob = ActiveStorage::Blob.create_and_upload!(io: file.tempfile, filename: name, content_type: 'application/octet-stream', identify: false)
      uploaded << blob
      document = room.documents.create!(account_id: Current.account.id, user: current_user, message: message, filename: name, byte_size: file.size, checksum: checksum, client_id: attempt)
      document.file.attach(blob)
      document
    end
  end
end
