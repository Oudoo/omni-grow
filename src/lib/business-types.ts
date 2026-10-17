export interface Business {
  account_id: number; name: string; description: string; website: string; accent_color: string;
  plan: 'inbox' | 'team' | 'business'; team_enabled: boolean; inbox_enabled: boolean; status: string;
  seat_limit: number; used_seats: number; storage_limit_bytes: number; storage_used_bytes: number; has_logo: boolean; logo_version: string | null;
  access_enabled: boolean; subscription: BusinessSubscription;
}
export interface BusinessSubscription {
  interval: 'unlimited' | 'monthly' | 'yearly'; status: 'unlimited' | 'scheduled' | 'active' | 'grace' | 'expired' | 'cancelled';
  starts_at: string | null; paid_through: string | null; access_until: string | null;
  grace_days: number; version: number; collection: 'manual'; amount_minor?: number; currency?: string; currency_exponent?: number;
}
export interface SubscriptionChange { id: number; actor_id: number | null; action: string; reference: string; terms: BusinessSubscription; created_at: string }
export interface BusinessContext { business: Business; administrator: boolean; operator: boolean; meetings_configured: boolean }
export interface Employee { id: number; name: string; email: string; role: 'administrator' | 'agent' }
export interface Invitation { id: number; email: string; name: string; role: string; expires_at: string }
export interface TeamMeeting { id: number; room_id: number; host_id: number; started_at: string; ended_at: string | null }
export interface TeamRoom { id: number; name: string; description: string; kind: 'public' | 'private' | 'direct'; creator_id: number; members: { id: number; name: string }[]; archived_at: string | null; unread_count: number; meeting: TeamMeeting | null; updated_at: string }
export interface TeamDocument { id: number; room_id: number; message_id: number | null; filename: string; byte_size: number; checksum: string; user: { id: number; name: string }; created_at: string }
export interface TeamMessage { id: number; room_id: number; user: { id: number; name: string }; content: string; client_id: string; reply_to_id: number | null; created_at: string; edited_at: string | null; deleted_at: string | null; documents: TeamDocument[] }
export interface MeetingAdmission { token: string; url: string; identity: string; meeting: TeamMeeting }
