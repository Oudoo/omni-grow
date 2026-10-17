require 'digest'
require 'securerandom'
module OmniGrow
  class Error < StandardError
    attr_reader :status
    def initialize(message, status = 422)
      @status = status
      super(message)
    end
  end
  class Business < ApplicationRecord
    self.table_name = 'og_businesses'
    belongs_to :account
    has_one_attached :logo
    validates :plan, inclusion: { in: %w[inbox team business] }
    validates :seat_limit, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 10000 }
    validates :storage_limit_bytes, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 10 * 1024**4 }
    validates :accent_color, format: { with: /\A#[0-9a-fA-F]{6}\z/ }
    validates :description, length: { maximum: 1000 }
    validates :website, length: { maximum: 500 }
    def team? = %w[team business].include?(plan)
    def inbox? = %w[inbox business].include?(plan)
    def used_storage = Document.where(account_id: account_id).sum(:byte_size)
    def used_seats = account.account_users.count + Invitation.pending.where(account_id: account_id).count
    def payload(financial: false)
      { account_id: account_id, name: account.name, description: description, website: website, accent_color: accent_color,
        plan: plan, team_enabled: team?, inbox_enabled: inbox?, seat_limit: seat_limit, used_seats: used_seats,
        storage_limit_bytes: storage_limit_bytes, storage_used_bytes: used_storage, has_logo: logo.attached?, logo_version: logo.attached? ? Digest::SHA256.hexdigest(logo.blob.checksum).first(16) : nil, status: account.status,
        access_enabled: access_enabled?, subscription: subscription_payload(financial: financial) }
    end
  end
  class Invitation < ApplicationRecord
    self.table_name = 'og_invitations'
    belongs_to :account
    scope :pending, -> { where(accepted_at: nil, revoked_at: nil).where('expires_at > ?', Time.current) }
    validates :email, format: { with: URI::MailTo::EMAIL_REGEXP }, length: { maximum: 254 }
    validates :name, length: { in: 1..100 }
    validates :role, inclusion: { in: %w[agent administrator] }
    def self.issue!(account:, email:, name:, role:)
      email = email.to_s.strip.downcase
      raise Error, 'This person already belongs to this business.' if account.users.where('lower(email) = ?', email).exists?
      where(account_id: account.id, email: email, accepted_at: nil, revoked_at: nil).update_all(revoked_at: Time.current)
      business = Business.find_by!(account_id: account.id)
      raise Error, 'The employee seat limit has been reached.' if business.used_seats >= business.seat_limit
      token = SecureRandom.urlsafe_base64(32)
      invite = create!(account: account, email: email, name: name.to_s.strip, role: role, token_digest: Digest::SHA256.hexdigest(token), expires_at: 7.days.from_now)
      [invite, token]
    end
    def public_payload = { id: id, email: email, name: name, role: role, expires_at: expires_at }
  end
  class Room < ApplicationRecord
    self.table_name = 'og_rooms'
    belongs_to :account
    belongs_to :creator, class_name: 'User'
    has_many :members, class_name: 'OmniGrow::RoomMember', dependent: :destroy
    has_many :messages, class_name: 'OmniGrow::Message', dependent: :destroy
    has_many :documents, class_name: 'OmniGrow::Document', dependent: :destroy
    has_many :meetings, class_name: 'OmniGrow::Meeting', dependent: :destroy
    validates :name, length: { in: 1..80 }
    validates :description, length: { maximum: 1000 }
    validates :kind, inclusion: { in: %w[public private direct] }
    def self.visible(account, user)
      where(account_id: account.id).where("kind = 'public' OR id IN (SELECT room_id FROM og_room_members WHERE account_id = ? AND user_id = ?)", account.id, user.id)
    end
    def user_ids
      scope = account.account_users
      scope = scope.where(user_id: members.select(:user_id)) unless kind == 'public'
      scope.pluck(:user_id)
    end
    def accessible?(user_id) = account.account_users.where(user_id: user_id).exists? && (kind == 'public' || members.where(user_id: user_id).exists?)
    def emit(event = 'team.changed')
      # Names, content and attachment metadata are never broadcast account-wide.
      User.where(id: user_ids).pluck(:pubsub_token).each do |token|
        ActionCable.server.broadcast(token, { event: event, data: { account_id: account_id, room_id: id } })
      end
    rescue StandardError => error
      Rails.logger.warn("OmniGrow realtime delivery failed (#{error.class.name}); clients will poll persisted state")
    end
    def payload(user)
      people = User.where(id: members.select(:user_id)).select(:id, :name).map { |p| { id: p.id, name: p.name } }
      read_id = Read.find_by(room_id: id, user_id: user.id)&.message_id || 0
      { id: id, name: kind == 'direct' ? (people.reject { |p| p[:id] == user.id }.map { |p| p[:name] }.join(', ').presence || name) : name,
        description: description, kind: kind, creator_id: creator_id, members: people, archived_at: archived_at,
        unread_count: messages.where('id > ?', read_id).where.not(user_id: user.id).where(deleted_at: nil).count,
        meeting: meetings.where(ended_at: nil).first&.payload, updated_at: updated_at }
    end
  end
  class RoomMember < ApplicationRecord
    self.table_name = 'og_room_members'
    belongs_to :room, class_name: 'OmniGrow::Room'
    belongs_to :user
  end
  class Read < ApplicationRecord
    self.table_name = 'og_reads'
  end
  class Message < ApplicationRecord
    self.table_name = 'og_messages'
    belongs_to :room, class_name: 'OmniGrow::Room'
    belongs_to :user
    has_many :documents, class_name: 'OmniGrow::Document', dependent: :destroy
    validates :content, length: { maximum: 8000 }
    def payload
      { id: id, room_id: room_id, user: { id: user.id, name: user.name }, content: deleted_at ? '' : content,
        client_id: client_id, reply_to_id: reply_to_id, created_at: created_at, edited_at: edited_at, deleted_at: deleted_at,
        documents: deleted_at ? [] : documents.map(&:payload) }
    end
  end
  class Document < ApplicationRecord
    self.table_name = 'og_documents'
    belongs_to :room, class_name: 'OmniGrow::Room'
    belongs_to :user
    belongs_to :message, class_name: 'OmniGrow::Message', optional: true
    has_one_attached :file
    def payload = { id: id, room_id: room_id, message_id: message_id, filename: filename, byte_size: byte_size, checksum: checksum, user: { id: user.id, name: user.name }, created_at: created_at }
  end
  class Meeting < ApplicationRecord
    self.table_name = 'og_meetings'
    belongs_to :room, class_name: 'OmniGrow::Room'
    belongs_to :user
    scope :active, -> { where(ended_at: nil) }
    def payload = { id: id, room_id: room_id, host_id: user_id, started_at: created_at, ended_at: ended_at }
  end
  class Audit < ApplicationRecord
    self.table_name = 'og_audits'
    def self.record(account, user, action, details = {})
      create!(account_id: account.id, actor_id: user&.id, action: action, details: details, created_at: Time.current)
    end
  end
end
