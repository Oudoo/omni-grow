export interface Account { id: number; name: string; role: string; status?: string }
export interface Profile { id: number; name: string; email: string; accounts: Account[]; account_id: number; pubsub_token?: string }
export interface Inbox { id: number; name: string; channel_type: string; website_token?: string; website_url?: string; phone_number?: string; email?: string; bot_name?: string; reauthorization_required?: boolean; greeting_enabled?: boolean; greeting_message?: string; enable_auto_assignment?: boolean; csat_survey_enabled?: boolean }
export interface Contact { id: number; name: string; email?: string; phone_number?: string; thumbnail?: string; identifier?: string; additional_attributes?: Record<string, unknown>; custom_attributes?: Record<string, unknown> }
export interface Agent { id: number; name: string; email: string; role: string; availability_status?: string }
export interface Attachment { id: number; file_type: string; data_url: string; thumb_url?: string; file_size?: number; extension?: string }
export interface Message { id: number; content: string | null; message_type: number; private: boolean; created_at: number; status?: string; content_type?: string; content_attributes?: { omnigrow_client_id?: string; external_error?: string; email?: { subject?: string } }; attachments?: Attachment[]; sender?: { id: number; name: string; type?: string } }
export interface Conversation { id: number; inbox_id: number; status: string; priority?: string | null; labels: string[]; unread_count: number; created_at: number; last_activity_at: number; messages: Message[]; meta: { sender: Contact; assignee?: Agent | null; team?: { id: number; name: string } }; additional_attributes?: Record<string, unknown> }
export interface CannedResponse { id: number; short_code: string; content: string }
export interface Automation { id: number; name: string; description?: string; active: boolean; event_name: string; conditions: unknown[]; actions: { action_name: string; action_params: string[] }[] }
export interface Webhook { id: number; url: string; subscriptions: string[] }
export interface AgentBot { id: number; name: string; description?: string; outgoing_url: string }
