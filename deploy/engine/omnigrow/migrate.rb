# Run once during setup/upgrades, before web and worker start. The migration lock
# and separate ledger keep extension versions independent of upstream migrations.
class OmniGrowSchemaMigration < ActiveRecord::SchemaMigration
  def table_name = 'og_schema_migrations'
end
pool = ActiveRecord::Base.connection_pool
ActiveRecord::MigrationContext.new('/app/omnigrow/migrations', OmniGrowSchemaMigration.new(pool)).migrate
# Existing workspaces keep the inbox and gain the Business package on upgrade.
Account.find_each { |account| OmniGrow::Business.find_or_create_by!(account_id: account.id) { |business| business.plan = 'business' } }
puts 'OmniGrow business schema is current.'
