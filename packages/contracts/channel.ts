export interface ChannelInboundFrame {
  id: string;
  ts: number;
  content: { text: string };
  meta?: {
    user_id?: string;
    event_type?: string;
  } & Record<string, unknown>;
}

export interface ChannelOutboundFrame {
  id: string;
  ts: number;
  reply_to?: string;
  content: { text: string };
  meta?: Record<string, unknown>;
}
