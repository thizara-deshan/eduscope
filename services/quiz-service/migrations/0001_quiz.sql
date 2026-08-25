CREATE TABLE devices (
  device_id text PRIMARY KEY,
  credential_hash text NOT NULL,
  hall_display_name varchar(128) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE quiz_sessions (
  id text PRIMARY KEY,
  lecture_session_id text NOT NULL,
  device_id text NOT NULL REFERENCES devices(device_id),
  hall_display_name varchar(128) NOT NULL,
  join_code varchar(8) NOT NULL,
  join_url varchar(256) NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('open','closed')),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  next_answer_seq bigint NOT NULL DEFAULT 0 CHECK (next_answer_seq >= 0)
);
CREATE UNIQUE INDEX one_open_quiz_session_per_lecture
  ON quiz_sessions(lecture_session_id) WHERE state='open';
CREATE UNIQUE INDEX one_open_quiz_session_per_join_code
  ON quiz_sessions(join_code) WHERE state='open';
CREATE INDEX quiz_sessions_device_idx ON quiz_sessions(device_id);

CREATE TABLE students (
  id text PRIMARY KEY,
  student_id_number varchar(32) NOT NULL UNIQUE,
  full_name varchar(128) NOT NULL,
  auth_method varchar(32) NOT NULL CHECK (auth_method IN ('self-registered','sso')),
  sso_subject varchar(128),
  credential_ref varchar(128),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE participants (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  joined_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  connection_state varchar(16) NOT NULL CHECK (connection_state IN ('online','offline')),
  UNIQUE (quiz_session_id, student_id)
);
CREATE INDEX participants_session_idx ON participants(quiz_session_id);

CREATE TABLE participant_sessions (
  token_hash text PRIMARY KEY,
  participant_id text NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX participant_sessions_participant_idx ON participant_sessions(participant_id);

CREATE TABLE publications (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL,
  correct_option_id text NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('open','closed')),
  published_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason varchar(32) CHECK (close_reason IN ('next-question','session-ended','lecturer-closed'))
);
CREATE UNIQUE INDEX one_open_publication_per_quiz_session
  ON publications(quiz_session_id) WHERE state='open';
CREATE INDEX publications_session_time_idx ON publications(quiz_session_id,published_at DESC);

CREATE TABLE answers (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  publication_id text NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  selected_option_id text NOT NULL,
  is_correct boolean NOT NULL,
  points_awarded integer NOT NULL CHECK (points_awarded IN (0,10)),
  response_time_ms integer NOT NULL CHECK (response_time_ms >= 0),
  submitted_at timestamptz NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  UNIQUE (publication_id, student_id),
  UNIQUE (quiz_session_id, seq)
);
CREATE INDEX answers_replay_idx ON answers(quiz_session_id,seq);
