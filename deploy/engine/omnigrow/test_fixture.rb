require 'json'
input = JSON.parse(STDIN.read)
run = input.fetch('run')
raise 'Invalid test run' unless /\Aogbiz[a-f0-9]{16}\z/.match?(run)
if input.fetch('action') == 'create'
  password = SecureRandom.urlsafe_base64(24) + 'aA1!'
  account = Account.create!(name: "OG business test #{run} Operator")
  user = SuperAdmin.new(name: 'Acceptance operator', email: "#{run}-operator@example.test", password: password)
  user.skip_confirmation!
  user.save!
  AccountUser.create!(account: account, user: user, role: :administrator)
  OmniGrow::Business.create!(account: account, plan: 'business')
  puts "OG_BUSINESS_FIXTURE:#{JSON.generate({ run: run, operator: { id: user.id, email: user.email, password: password }, account_id: account.id })}"
elsif %w[native_remove native_suspend native_reassign stale_meeting probe_event expire_invitation expire_subscription subscription_calendar].include?(input['action'])
  account = Account.find(input.fetch('account_id'))
  raise 'Fixture account scope required' unless account.name.start_with?("OG business test #{run}")
  case input['action']
  when 'native_remove'
    account.account_users.find_by!(user_id: input.fetch('user_id')).destroy!
  when 'native_suspend'
    account.update!(status: :suspended)
  when 'native_reassign'
    member = account.account_users.find_by!(user_id: input.fetch('user_id'))
    destination = Account.find(input.fetch('destination_id'))
    raise 'Fixture destination scope required' unless destination.name.start_with?("OG business test #{run}")
    begin
      member.update!(account_id: destination.id)
      raise 'Native identity reassignment was not blocked'
    rescue OmniGrow::Error
      puts 'OG_NATIVE_REASSIGNMENT_BLOCKED'
    end
  when 'stale_meeting'
    room = OmniGrow::Room.where(account_id: account.id).find(input.fetch('room_id'))
    OmniGrow::Meeting.create!(account_id: account.id, room: room, user_id: input.fetch('user_id'), room_name: "og_missing_#{SecureRandom.uuid}")
  when 'probe_event'
    user = account.users.find(input.fetch('user_id'))
    # A real native broadcast with a unique sentinel tests delivery-time checks
    # on already-open sockets, including jobs queued before a plan change.
    ActionCable.server.broadcast(user.pubsub_token, { event: 'message.created', data: { account_id: account.id, content: input.fetch('sentinel') } })
  when 'expire_invitation'
    OmniGrow::Invitation.where(account_id: account.id).find(input.fetch('invitation_id')).update!(expires_at: 1.minute.ago)
  when 'expire_subscription'
    job = Sidekiq::Cron::Job.find('omnigrow_subscription_expiry')
    raise 'Subscription expiry schedule missing' unless job && job.status == 'enabled'
    business = OmniGrow::Business.find_by!(account_id: account.id)
    business.update!(subscription_interval: 'monthly', subscription_state: 'enabled', subscription_anchor_at: 2.months.ago,
                     subscription_cycles: 1, subscription_paid_through: 1.second.ago, subscription_grace_days: 0)
    OmniGrow::SubscriptionExpiryJob.perform_later
  when 'subscription_calendar'
    # Exercise the actual term arithmetic and boundary predicates; no global
    # clock is changed for the running application or other test accounts.
    business = OmniGrow::Business.find_by!(account_id: account.id)
    anchor = Time.utc(2028, 1, 31, 12, 0, 0)
    raise 'Month-end anchor lost' unless OmniGrow::Subscriptions.end_of_term(anchor, 'monthly', 1) == Time.utc(2028, 2, 29, 12, 0, 0)
    raise 'Renewal anchor drifted' unless OmniGrow::Subscriptions.end_of_term(anchor, 'monthly', 2) == Time.utc(2028, 3, 31, 12, 0, 0)
    leap = Time.utc(2028, 2, 29, 12, 0, 0)
    raise 'Annual leap handling failed' unless OmniGrow::Subscriptions.end_of_term(leap, 'yearly', 1) == Time.utc(2029, 2, 28, 12, 0, 0)
    raise 'Annual anchor drifted' unless OmniGrow::Subscriptions.end_of_term(leap, 'yearly', 4) == Time.utc(2032, 2, 29, 12, 0, 0)
    business.assign_attributes(subscription_interval: 'monthly', subscription_state: 'enabled', subscription_anchor_at: anchor,
                               subscription_paid_through: OmniGrow::Subscriptions.end_of_term(anchor, 'monthly', 1), subscription_grace_days: 2)
    raise 'Future access granted' unless business.subscription_status(anchor - 1) == 'scheduled'
    raise 'Start boundary failed' unless business.subscription_status(anchor) == 'active'
    raise 'Grace boundary failed' unless business.subscription_status(business.subscription_paid_through) == 'grace'
    raise 'Expiry boundary failed' unless business.subscription_status(business.subscription_access_until) == 'expired'
  end
  puts 'OG_BUSINESS_FIXTURE_ACTION_OK'
elsif input['action'] == 'cleanup'
  Account.where('name LIKE ?', "OG business test #{run}%").find_each do |account|
    OmniGrow::Meeting.active.where(account_id: account.id).each { |meeting| OmniGrow::Meetings.end!(meeting) }
    OmniGrow::Document.where(account_id: account.id).each { |document| document.file.purge if document.file.attached? }
    business = OmniGrow::Business.find_by(account_id: account.id)
    business.logo.purge if business&.logo&.attached?
    account.contacts.find_each(&:destroy!)
    # Direct account destruction cascades the extension's tenant foreign keys.
    account.destroy!
  end
  User.where('email LIKE ?', "#{run}-%@example.test").find_each { |user| user.destroy! if user.accounts.empty? }
  puts 'Business test fixtures removed.'
else
  raise 'Unknown test action'
end
