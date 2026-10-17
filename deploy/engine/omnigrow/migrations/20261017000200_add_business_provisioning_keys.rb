class AddBusinessProvisioningKeys < ActiveRecord::Migration[7.1]
  def change
    add_column :og_businesses, :provisioning_key, :uuid
    add_column :og_businesses, :provisioning_digest, :string, limit: 64
    add_index :og_businesses, :provisioning_key, unique: true
  end
end
