module OmniGrow
  # Native installation-console and platform-API changes must have the same
  # revocation semantics as the OmniGrow UI. Locks survive until the enclosing
  # ActiveRecord save/destroy transaction commits.
  module MembershipLifecycle
    extend ActiveSupport::Concern
    included do
      before_create :omnigrow_check_seats
      before_destroy :omnigrow_revoke_membership, prepend: true
      before_update :omnigrow_keep_administrator
      before_update :omnigrow_keep_membership_identity
    end
    def omnigrow_check_seats
      return unless OmniGrow::Business.table_exists?
      business = OmniGrow::Business.find_by(account_id: account_id)
      return unless business
      business.with_lock do
        raise OmniGrow::Error, 'This business is suspended.' unless account.reload.active?
        reserved = OmniGrow::Invitation.pending.where(account_id: account_id).where.not(email: user.email.downcase).count
        raise OmniGrow::Error, 'The employee seat limit has been reached.' if account.account_users.count + reserved >= business.seat_limit
      end
    end
    def omnigrow_keep_administrator
      return unless will_save_change_to_role? && role_in_database == 'administrator' && !administrator?
      business = OmniGrow::Business.find_by(account_id: account_id) if OmniGrow::Business.table_exists?
      business&.with_lock do
        raise OmniGrow::Error, 'A business must keep at least one administrator.' unless account.account_users.where(role: :administrator).where.not(id: id).exists?
      end
    end
    def omnigrow_keep_membership_identity
      return unless (will_save_change_to_account_id? || will_save_change_to_user_id?) && OmniGrow::Business.table_exists?
      if OmniGrow::Business.where(account_id: [account_id, account_id_in_database]).exists?
        raise OmniGrow::Error, 'Employee identities cannot be reassigned. Remove the employee and issue an invitation instead.'
      end
    end
    def omnigrow_revoke_membership
      business = OmniGrow::Business.find_by(account_id: account_id) if OmniGrow::Business.table_exists?
      return unless business
      business.with_lock do
        reload
        if administrator? && !account.account_users.where(role: :administrator).where.not(id: id).exists?
          raise OmniGrow::Error, 'A business must keep at least one administrator.'
        end
        OmniGrow::Meetings.end_for_user!(account, user_id)
        # A rehire starts a fresh direct conversation. Retained participants
        # keep the archived history; removed participants never regain it.
        OmniGrow::Room.where(account_id: account_id, kind: 'direct', id: OmniGrow::RoomMember.where(account_id: account_id, user_id: user_id).select(:room_id)).find_each do |room|
          room.update!(direct_key: nil, archived_at: Time.current,
                       name: User.where(id: room.members.select(:user_id)).pluck(:name).join(', ').first(80))
        end
      end
    end
  end
  module AccountLifecycle
    extend ActiveSupport::Concern
    included do
      before_update :omnigrow_suspend_meetings
      before_destroy :omnigrow_remove_business, prepend: true
    end
    def omnigrow_suspend_meetings
      return unless will_save_change_to_status? && suspended? && OmniGrow::Business.table_exists?
      business = OmniGrow::Business.find_by(account_id: id)
      business&.with_lock { OmniGrow::Meeting.active.where(account_id: id).find_each { |meeting| OmniGrow::Meetings.end!(meeting) } }
    end
    def omnigrow_remove_business
      return unless OmniGrow::Business.table_exists?
      business = OmniGrow::Business.find_by(account_id: id)
      business&.with_lock do
        OmniGrow::Meeting.active.where(account_id: id).find_each { |meeting| OmniGrow::Meetings.end!(meeting) }
        # Run attachment callbacks before the database cascades tenant rows.
        OmniGrow::Document.where(account_id: id).find_each(&:destroy!)
        business.destroy!
      end
    end
  end
end
AccountUser.include(OmniGrow::MembershipLifecycle) unless AccountUser < OmniGrow::MembershipLifecycle
Account.include(OmniGrow::AccountLifecycle) unless Account < OmniGrow::AccountLifecycle
