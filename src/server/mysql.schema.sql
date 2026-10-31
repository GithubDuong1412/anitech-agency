create table if not exists meta (
  department_id varchar(32) not null,
  meta_key varchar(64) not null,
  meta_value text not null,
  primary key (department_id, meta_key)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists tasks (
  department_id varchar(32) not null,
  id varchar(64) not null,
  title_key varchar(64) not null,
  title text,
  owner_id varchar(64) not null,
  status varchar(32) not null,
  run_mode varchar(16) null,
  provider varchar(64) null,
  model varchar(160) null,
  progress int not null,
  created_at bigint not null,
  seq bigint unsigned not null auto_increment,
  primary key (department_id, id),
  unique key tasks_seq (seq)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists threads (
  department_id varchar(32) not null,
  id varchar(80) not null,
  task_id varchar(64),
  topic_key varchar(64),
  topic_title text,
  status varchar(32) not null,
  seq bigint unsigned not null auto_increment,
  primary key (department_id, id),
  unique key threads_seq (seq)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists thread_participants (
  department_id varchar(32) not null,
  thread_id varchar(80) not null,
  agent_id varchar(64) not null,
  position int not null,
  primary key (department_id, thread_id, agent_id),
  constraint fk_participants_thread foreign key (department_id, thread_id) references threads (department_id, id) on delete cascade
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists messages (
  department_id varchar(32) not null,
  id varchar(80) not null,
  thread_id varchar(80) not null,
  from_agent varchar(64) not null,
  kind varchar(32) not null,
  text_key varchar(160),
  text text,
  at bigint not null,
  seq bigint unsigned not null auto_increment,
  primary key (department_id, id),
  unique key messages_seq (seq),
  key messages_thread (department_id, thread_id),
  constraint fk_messages_thread foreign key (department_id, thread_id) references threads (department_id, id) on delete cascade
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists activities (
  id bigint unsigned not null auto_increment,
  department_id varchar(32) not null,
  type varchar(32) not null,
  agent_id varchar(64),
  message_key varchar(160),
  created_at bigint not null,
  legacy_id bigint null,
  primary key (id),
  unique key activities_legacy (department_id, legacy_id),
  key activities_dept (department_id, id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;
