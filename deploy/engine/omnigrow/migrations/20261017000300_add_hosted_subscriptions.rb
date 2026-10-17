class AddHostedSubscriptions < ActiveRecord::Migration[7.2]
  def change
    change_table :og_businesses do |t|
      # Existing installations remain available until the operator assigns a term.
      t.string :subscription_interval, null: false, default: 'unlimited'
      t.string :subscription_state, null: false, default: 'enabled'
      t.datetime :subscription_anchor_at
      t.datetime :subscription_paid_through
      t.integer :subscription_cycles, null: false, default: 0
      t.integer :subscription_grace_days, null: false, default: 0
      t.bigint :subscription_amount_minor, null: false, default: 0
      t.string :subscription_currency, null: false, default: 'USD'
      t.integer :subscription_version, null: false, default: 0
    end
    add_check_constraint :og_businesses, "subscription_interval IN ('unlimited','monthly','yearly') AND subscription_state IN ('enabled','cancelled')", name: 'og_subscription_kind'
    add_check_constraint :og_businesses, 'subscription_grace_days BETWEEN 0 AND 30 AND subscription_amount_minor BETWEEN 0 AND 1000000000000 AND subscription_version >= 0', name: 'og_subscription_limits'
    add_check_constraint :og_businesses, "(subscription_interval = 'unlimited' AND subscription_anchor_at IS NULL AND subscription_paid_through IS NULL AND subscription_cycles = 0) OR (subscription_interval IN ('monthly','yearly') AND subscription_anchor_at IS NOT NULL AND subscription_paid_through > subscription_anchor_at AND subscription_cycles BETWEEN 1 AND 1200)", name: 'og_subscription_dates'
    add_index :og_businesses, :subscription_paid_through
    create_table :og_subscription_changes do |t|
      t.references :account, null: false, foreign_key: { on_delete: :cascade }
      t.bigint :actor_id
      t.string :client_id, null: false
      t.string :request_digest, null: false
      t.string :action, null: false
      t.string :reference, null: false
      t.jsonb :terms, null: false
      t.datetime :created_at, null: false
    end
    add_index :og_subscription_changes, [:account_id, :client_id], unique: true, name: 'og_subscription_attempt'
    add_index :og_subscription_changes, [:account_id, :id]
    add_index :og_subscription_changes, 'account_id, lower(reference)', unique: true, where: "action IN ('activate','renew')", name: 'og_subscription_payment_reference'
  end
end
