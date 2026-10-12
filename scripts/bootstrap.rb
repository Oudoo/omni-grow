require 'json'
credentials = JSON.parse(STDIN.read)
user = if credentials['owner_id']
         User.find_by(id: credentials.fetch('owner_id'))
       else
         User.find_by(email: credentials.fetch('email'))
       end
if credentials['owner_id'] && !user
  raise 'Initial owner no longer exists. Existing users were preserved; review administration rather than reprovisioning from old credentials.'
end
unless user
  ActiveRecord::Base.transaction do
    account = Account.create!(name: credentials.fetch('workspace'))
    user = User.new(name: credentials.fetch('name'), email: credentials.fetch('email'), password: credentials.fetch('password'))
    user.skip_confirmation!
    user.save!
    AccountUser.create!(account: account, user: user, role: :administrator)
  end
end
raise 'Owner has no workspace membership' if user.accounts.empty?
puts 'OmniGrow workspace owner is provisioned. No sample contacts or conversations were created.'
puts "OG_BOOTSTRAP_JSON:#{JSON.generate({ owner_id: user.id })}"
