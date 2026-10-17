# The extension is loaded by both Rails and Sidekiq. Migrations run explicitly
# from setup/migrate, never during concurrent worker/web startup.
Rails.application.config.filter_parameters += %i[token password client_secret invitation_token]
Rails.application.config.to_prepare do
  require '/app/omnigrow/models'
  require '/app/omnigrow/meetings'
  require '/app/omnigrow/subscriptions'
  require '/app/omnigrow/lifecycle'
  require '/app/omnigrow/realtime'
  require '/app/omnigrow/business_controller'
  require '/app/omnigrow/operator_controller'

  unless Api::V1::Accounts::BaseController.method_defined?(:omnigrow_package_guard)
    Api::V1::Accounts::BaseController.class_eval do
      before_action :omnigrow_package_guard
      def omnigrow_package_guard
        return unless Current.account && OmniGrow::Business.table_exists?
        business = OmniGrow::Business.find_by(account_id: Current.account.id)
        return unless business
        return if is_a?(OmniGrow::BusinessController)
        # Employee lifecycle must use the invitation-aware endpoints; native
        # membership writes would bypass seat limits and meeting revocation.
        if !business.subscription_available?
          render json: { error: 'This business subscription is inactive. Contact your service provider to renew it.' }, status: :payment_required
        elsif controller_path == 'api/v1/accounts/agents' && !request.get? && !request.head?
          render json: { error: 'Manage employees through Business settings.' }, status: :forbidden
        elsif !business.inbox?
          render json: { error: 'The customer inbox is not included in this business package.' }, status: :forbidden
        end
      end
    end
  end
end

Rails.application.routes.prepend do
  scope '/api/v1/accounts/:account_id/business', controller: 'omni_grow/business' do
    get 'context', action: :context
    patch 'branding', action: :branding
    get 'logo', action: :logo
    get 'members', action: :members
    post 'invitations', action: :invite
    delete 'invitations/:id', action: :revoke_invite
    patch 'members/:id', action: :update_member
    delete 'members/:id', action: :remove_member
    get 'audit', action: :audit
    get 'subscription', action: :subscription
    get 'rooms', action: :rooms
    post 'rooms', action: :create_room
    get 'rooms/:id', action: :show_room
    patch 'rooms/:id', action: :update_room
    get 'rooms/:id/messages', action: :messages
    post 'rooms/:id/messages', action: :create_message
    patch 'rooms/:id/messages/:message_id', action: :change_message
    delete 'rooms/:id/messages/:message_id', action: :change_message
    post 'rooms/:id/read', action: :mark_read
    post 'rooms/:id/meetings', action: :start_meeting
    post 'rooms/:id/meetings/:meeting_id/join', action: :join_meeting
    delete 'rooms/:id/meetings/:meeting_id', action: :end_meeting
    get 'documents', action: :documents
    post 'documents', action: :upload_document
    get 'documents/:id/content', action: :download_document
    delete 'documents/:id', action: :delete_document
  end
  scope '/api/v1/omnigrow', controller: 'omni_grow/operator' do
    get 'businesses', action: :index
    post 'businesses', action: :create
    patch 'businesses/:id', action: :update
    post 'businesses/:id/invitations', action: :invite
    get 'businesses/:id/subscription', action: :subscription
    post 'businesses/:id/subscription', action: :change_subscription
  end
  post '/api/v1/omnigrow/invitations/preview', to: 'omni_grow/invitations#preview'
  post '/api/v1/omnigrow/invitations/accept', to: 'omni_grow/invitations#accept'
  post '/omnigrow/meeting-events', to: 'omni_grow/meeting_webhooks#create'
end
