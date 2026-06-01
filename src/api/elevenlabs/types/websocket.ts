export interface AudioEvent {
  type: 'audio';
  audio_event: {
    audio_base_64: string;
    event_id: number | string;
    alignment?: {
      chars: string[];
      char_durations_ms: number[];
      char_start_times_ms: number[];
    };
  };
}

export interface ConversationInitiationMetadataEvent {
  type: 'conversation_initiation_metadata';
  conversation_initiation_metadata_event: {
    conversation_id: string;
    agent_output_audio_format?: string;
    user_input_audio_format?: string;
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

export interface ClientToolCallEvent {
  type: 'client_tool_call';
  client_tool_call?: {
    tool_name?: string;
    tool_call_id?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface InterruptionEvent {
  type: 'interruption';
  interruption_event?: {
    event_id?: number | string;
  };
}

export interface UserAudioChunkEvent {
  user_audio_chunk: string;
}

export interface ClientToolResultEvent {
  type: 'client_tool_result';
  tool_call_id: string;
  result: string;
  is_error: boolean;
}

export type ElevenLabsWebSocketEvent =
  | ConversationInitiationMetadataEvent
  | UserTranscriptEvent
  | AgentResponseEvent
  | AudioEvent
  | InterruptionEvent
  | ClientToolCallEvent;
