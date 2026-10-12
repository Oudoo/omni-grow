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
# The installation owner also administers the engine itself (installation settings, feature flags,
# the job dashboard) through the native /super_admin console, with the same credentials. Passwords
# are never changed here.
if credentials['super_admin'] && !user.is_a?(SuperAdmin)
  user.update!(type: 'SuperAdmin')
  user = User.find(user.id)
end
puts 'OmniGrow workspace owner is provisioned. No sample contacts or conversations were created.'
puts "OG_BOOTSTRAP_JSON:#{JSON.generate({ owner_id: user.id, super_admin: user.is_a?(SuperAdmin) })}"
