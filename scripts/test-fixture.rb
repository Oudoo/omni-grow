# Invoked only by the integration suite. Creates isolated real database records.
require 'json'
input = JSON.parse(STDIN.read)
if input.fetch('action') == 'destroy'
  input.fetch('account_ids').each do |id|
    account = Account.find(id)
    raise 'Fixture scope required' unless account.name.start_with?('OmniGrow integration')
    # Native contact destruction emits an event requiring its account. Destroy
    # these while the parent exists instead of deferring them past its deletion.
    account.contacts.find_each(&:destroy!)
    # Fixture users are removed immediately below; prevent asynchronous agent
    # cleanup jobs from looking them up after they have already gone.
    account.account_users.delete_all
    account.destroy!
  end
  input.fetch('user_ids').each do |id|
    user = User.find(id)
    raise 'Fixture scope required' unless user.email.end_with?('@og-tests.local')
    user.destroy!
  end
  puts 'OG_FIXTURE_CLEANED'
elsif input.fetch('action') == 'revoke_membership'
  account = Account.find(input.fetch('account_id'))
  user = User.find(input.fetch('user_id'))
  raise 'Fixture scope required' unless account.name.start_with?('OmniGrow integration') && user.email.end_with?('@og-tests.local')
  AccountUser.find_by!(account: account, user: user).destroy!
  puts 'OG_MEMBERSHIP_REVOKED'
else
  result = { accounts: [], users: [] }
  %w[A B].each_with_index do |name, index|
    credentials = input.fetch('users')[index]
    account = Account.create!(name: "OmniGrow integration #{name}")
    user = User.new(name: "Integration owner #{name}", email: credentials.fetch('email'), password: credentials.fetch('password'))
    user.skip_confirmation!
    user.save!
    AccountUser.create!(account: account, user: user, role: :administrator)
    channel = account.web_widgets.create!(website_url: 'http://localhost:3000', widget_color: '#167d63', welcome_title: 'Talk to the team', welcome_tagline: 'Send a real message')
    inbox = account.inboxes.create!(name: "Integration website #{name}", channel: channel)
    InboxMember.create!(user: user, inbox: inbox)
    api_channel = account.api_channels.create!
    api_inbox = account.inboxes.create!(name: "Integration API #{name}", channel: api_channel)
    InboxMember.create!(user: user, inbox: api_inbox)
    result[:accounts] << { id: account.id, inbox_id: inbox.id, website_token: channel.website_token, api_inbox_id: api_inbox.id, identifier: api_channel.identifier }
    result[:users] << { id: user.id }.merge(credentials)
  end
  credentials = input.fetch('agent')
  agent = User.new(name: 'Restricted agent', email: credentials.fetch('email'), password: credentials.fetch('password'))
  agent.skip_confirmation!
  agent.save!
  AccountUser.create!(account_id: result[:accounts][0][:id], user: agent, role: :agent)
  result[:agent] = { id: agent.id }.merge(credentials)
  credentials = input.fetch('mfa')
  mfa_user = User.new(name: 'MFA owner', email: credentials.fetch('email'), password: credentials.fetch('password'))
  mfa_user.skip_confirmation!
  mfa_user.save!
  AccountUser.create!(account_id: result[:accounts][0][:id], user: mfa_user, role: :administrator)
  manager = Mfa::ManagementService.new(user: mfa_user)
  manager.enable_two_factor!
  codes = manager.verify_and_activate!
  result[:mfa] = { id: mfa_user.id, backup_code: codes.first }.merge(credentials)
  switch_account = Account.create!(name: 'OmniGrow integration switching')
  AccountUser.create!(account: switch_account, user_id: result[:users][0][:id], role: :administrator)
  result[:switch_account_id] = switch_account.id
  puts "OG_FIXTURE_JSON:#{result.to_json}"
end
