# Real, isolated records for a local concurrency benchmark. No production data.
require 'json'
require 'securerandom'
input = JSON.parse(STDIN.read)
if input.fetch('action') == 'destroy'
  account = Account.find_by(id: input.fetch('account_id'))
  raise 'Not an OmniGrow benchmark account' if account && !account.name.start_with?('OmniGrow benchmark ')
  if account
    account.contacts.find_each(&:destroy!)
    account.account_users.delete_all
    account.destroy!
  end
  user = User.find_by(id: input.fetch('user_id'))
  raise 'Not an OmniGrow benchmark user' if user && !user.email.match?(/\Aog-benchmark-[a-f0-9]+@example\.invalid\z/)
  user&.destroy!
  puts 'OG_LOAD_CLEANED'
else
  count = Integer(input.fetch('count'))
  raise 'Connection count out of range' unless count.between?(2, 10_000)
  result = nil
  ActiveRecord::Base.transaction do
    account = Account.create!(name: "OmniGrow benchmark #{SecureRandom.hex(5)}")
    user = User.new(name: 'Benchmark agent', email: "og-benchmark-#{SecureRandom.hex(8)}@example.invalid", password: "#{SecureRandom.urlsafe_base64(24)}aA1!")
    user.skip_confirmation!
    user.save!
    AccountUser.create!(account: account, user: user, role: :administrator)
    channel = account.api_channels.create!
    inbox = account.inboxes.create!(name: 'Benchmark API', channel: channel)
    InboxMember.create!(user: user, inbox: inbox)
    now = Time.current
    # Bulk inserts avoid spending the benchmark on creating fixtures.
    contacts = Contact.insert_all!(Array.new(count - 1) { |i| { account_id: account.id, name: "Benchmark contact #{i}", created_at: now, updated_at: now } }, returning: %w[id])
    contact_inboxes = contacts.rows.map { |row| { contact_id: row.first, inbox_id: inbox.id, source_id: SecureRandom.uuid, pubsub_token: SecureRandom.hex(24), created_at: now, updated_at: now } }
    ContactInbox.insert_all!(contact_inboxes)
    native_auth = user.create_new_auth_token
    result = { account_id: account.id, user_id: user.id, user_pubsub_token: user.pubsub_token, api_token: user.access_token.token, auth: native_auth.slice('access-token', 'client', 'uid'), identifier: channel.identifier,
               contacts: contact_inboxes.map { |contact| contact.slice(:source_id, :pubsub_token) } }
  end
  puts "OG_LOAD_JSON:#{result.to_json}"
end
