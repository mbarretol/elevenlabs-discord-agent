export interface AudioEvent {
  type: 'audio';
  audio_event: {
    audio_base_64: string;
    event_id: number;
  };
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

export interface InterruptionEvent {
  type: 'interruption';
  interruption_event: {
    event_id: number;
  };
}

export interface PingEvent {
  type: 'ping';
  ping_event: {
    event_id: number;
    ping_ms: number;
  };
}

export interface ClientToolCallEvent {
  type: 'client_tool_call';
  client_tool_call?: {
    tool_name?: string;
    tool_call_id?: string;
    parameters?: Record<string, any>;
  };
}
