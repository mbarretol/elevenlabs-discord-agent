export interface AudioEvent {
  type: 'audio';
  audio_event: {
    audio_base_64: string;
  };
}

export interface InterruptionEvent {
  type: 'interruption';
}

export interface UserTranscriptEvent {
  type: 'user_transcript';
  user_transcription_event: {
    user_transcript: string;
  };
}

export interface AgentResponseEvent {
  type: 'agent_response';
  agent_response_event: {
    agent_response: string;
  };
}

export interface PingEvent {
  type: 'ping';
  ping_event: {
    event_id: number;
    /** Estimated round trip to ElevenLabs, from earlier pings. */
    ping_ms?: number | null;
  };
}

export interface ClientToolCallEvent {
  type: 'client_tool_call';
  client_tool_call: {
    tool_name: string;
    tool_call_id: string;
    parameters?: Record<string, unknown>;
  };
}

/** The server events the bot acts on. Other event types are ignored. */
export type ServerEvent =
  | AudioEvent
  | InterruptionEvent
  | UserTranscriptEvent
  | AgentResponseEvent
  | PingEvent
  | ClientToolCallEvent;

export interface UserAudioChunkEvent {
  user_audio_chunk: string;
}

export interface ClientToolResultEvent {
  type: 'client_tool_result';
  tool_call_id: string;
  result: string;
  is_error: boolean;
}

export interface PongEvent {
  type: 'pong';
  event_id: number;
}

/** Context for the agent that it does not answer directly. */
export interface ContextualUpdateEvent {
  type: 'contextual_update';
  text: string;
}

export type ClientEvent =
  | UserAudioChunkEvent
  | ClientToolResultEvent
  | PongEvent
  | ContextualUpdateEvent;
