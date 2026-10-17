class CreateOmnigrowBusiness < ActiveRecord::Migration[7.2]
  def change
    create_table :og_businesses do |t|
      t.references :account, null: false, index: { unique: true }, foreign_key: { on_delete: :cascade }
      t.string :plan, null: false, default: 'inbox'
      t.string :description, limit: 1000, null: false, default: ''
      t.string :website, limit: 500, null: false, default: ''
      t.string :accent_color, null: false, default: '#167d63'
      t.integer :seat_limit, null: false, default: 50
      t.bigint :storage_limit_bytes, null: false, default: 10 * 1024**3
      t.timestamps
    end
    add_check_constraint :og_businesses, "plan IN ('inbox','team','business')", name: 'og_business_plan'
    add_check_constraint :og_businesses, 'seat_limit > 0 AND storage_limit_bytes > 0', name: 'og_business_limits'

    create_table :og_invitations do |t|
      t.references :account, null: false, foreign_key: { on_delete: :cascade }
      t.string :email, null: false
      t.string :name, null: false
      t.string :role, null: false, default: 'agent'
      t.string :token_digest, null: false
      t.datetime :expires_at, null: false
      t.datetime :accepted_at
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :og_invitations, :token_digest, unique: true
    add_index :og_invitations, [:account_id, :email], unique: true, where: 'accepted_at IS NULL AND revoked_at IS NULL', name: 'og_pending_invitation'
    add_check_constraint :og_invitations, "role IN ('administrator','agent')", name: 'og_invitation_role'

    create_table :og_rooms do |t|
      t.references :account, null: false, foreign_key: { on_delete: :cascade }
      t.bigint :creator_id, null: false
      t.string :name, null: false
      t.string :description, limit: 1000, null: false, default: ''
      t.string :kind, null: false, default: 'public'
      t.string :direct_key
      t.datetime :archived_at
      t.timestamps
    end
    add_foreign_key :og_rooms, :users, column: :creator_id
    add_index :og_rooms, [:account_id, :id], unique: true
    add_index :og_rooms, [:account_id, :direct_key], unique: true, where: 'direct_key IS NOT NULL'
    add_check_constraint :og_rooms, "kind IN ('public','private','direct')", name: 'og_room_kind'
    create_table :og_room_members do |t|
      t.bigint :account_id, null: false
      t.bigint :room_id, null: false
      t.bigint :user_id, null: false
      t.timestamps
    end
    add_index :og_room_members, [:room_id, :user_id], unique: true
    execute 'ALTER TABLE og_room_members ADD CONSTRAINT og_member_room FOREIGN KEY (account_id,room_id) REFERENCES og_rooms(account_id,id) ON DELETE CASCADE'
    execute 'ALTER TABLE og_room_members ADD CONSTRAINT og_member_account FOREIGN KEY (account_id,user_id) REFERENCES account_users(account_id,user_id) ON DELETE CASCADE'

    create_table :og_messages do |t|
      t.bigint :account_id, null: false
      t.bigint :room_id, null: false
      t.references :user, null: false, foreign_key: true
      t.text :content, null: false, default: ''
      t.string :client_id, null: false
      t.string :request_digest, null: false
      t.bigint :reply_to_id
      t.datetime :edited_at
      t.datetime :deleted_at
      t.timestamps
    end
    add_index :og_messages, [:room_id, :user_id, :client_id], unique: true, name: 'og_message_attempt'
    add_index :og_messages, [:room_id, :id]
    add_index :og_messages, [:account_id, :room_id, :id], unique: true
    execute 'ALTER TABLE og_messages ADD CONSTRAINT og_message_room FOREIGN KEY (account_id,room_id) REFERENCES og_rooms(account_id,id) ON DELETE CASCADE'
    execute 'ALTER TABLE og_messages ADD CONSTRAINT og_reply_room FOREIGN KEY (account_id,room_id,reply_to_id) REFERENCES og_messages(account_id,room_id,id)'

    create_table :og_documents do |t|
      t.bigint :account_id, null: false
      t.bigint :room_id, null: false
      t.bigint :message_id
      t.references :user, null: false, foreign_key: true
      t.string :filename, null: false
      t.bigint :byte_size, null: false
      t.string :checksum, null: false
      t.string :client_id, null: false
      t.timestamps
    end
    add_index :og_documents, [:room_id, :user_id, :client_id], unique: true, name: 'og_document_attempt'
    add_index :og_documents, [:account_id, :created_at]
    execute 'ALTER TABLE og_documents ADD CONSTRAINT og_document_room FOREIGN KEY (account_id,room_id) REFERENCES og_rooms(account_id,id) ON DELETE CASCADE'
    execute 'ALTER TABLE og_documents ADD CONSTRAINT og_document_message FOREIGN KEY (account_id,room_id,message_id) REFERENCES og_messages(account_id,room_id,id) ON DELETE CASCADE'
    add_check_constraint :og_documents, 'byte_size > 0 AND byte_size <= 20971520', name: 'og_document_size'

    create_table :og_reads do |t|
      t.bigint :account_id, null: false
      t.bigint :room_id, null: false
      t.bigint :user_id, null: false
      t.bigint :message_id, null: false, default: 0
      t.timestamps
    end
    add_index :og_reads, [:room_id, :user_id], unique: true
    execute 'ALTER TABLE og_reads ADD CONSTRAINT og_read_room FOREIGN KEY (account_id,room_id) REFERENCES og_rooms(account_id,id) ON DELETE CASCADE'
    execute 'ALTER TABLE og_reads ADD CONSTRAINT og_read_account FOREIGN KEY (account_id,user_id) REFERENCES account_users(account_id,user_id) ON DELETE CASCADE'

    create_table :og_meetings do |t|
      t.bigint :account_id, null: false
      t.bigint :room_id, null: false
      t.references :user, null: false, foreign_key: true
      t.string :room_name, null: false
      t.datetime :ended_at
      t.timestamps
    end
    add_index :og_meetings, :room_name, unique: true
    add_index :og_meetings, :room_id, unique: true, where: 'ended_at IS NULL', name: 'og_active_meeting'
    execute 'ALTER TABLE og_meetings ADD CONSTRAINT og_meeting_room FOREIGN KEY (account_id,room_id) REFERENCES og_rooms(account_id,id) ON DELETE CASCADE'

    create_table :og_audits do |t|
      t.references :account, null: false, foreign_key: { on_delete: :cascade }
      t.bigint :actor_id
      t.string :action, null: false
      t.jsonb :details, null: false, default: {}
      t.datetime :created_at, null: false
    end
    add_index :og_audits, [:account_id, :id]
  end
end
