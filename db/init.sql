create table users (
    user_id serial primary key,
    username varchar(50) not null unique,
    password_hash varchar(60) not null
);
create index idx_users_username_password on users(username,password_hash);
create table efforts (
    effort_id serial primary key,
    user_id serial references users(user_id),
    --achievement_id references foreign key 
    frequency interval,
    default_time time,
    default_priority int,
    default_duration interval,
    name varchar(100) not null,
    description text,
    start_date timestamp,
    end_date timestamp
);
create index idx_efforts_user on efforts(user_id);
--create index idx_efforts_achievement(achievement_id)

create table tasks (
    task_id serial primary key, --unique id
    user_id serial references users(user_id),
    effort_id serial references efforts(effort_id), --effort group
    name varchar(100) not null,
    description text,
    scheduled_timestamp timestamp, --timestamp of location on calneder
    min_timestamp timestamp, --maximum time of scheduling to still be valid
    max_timestamp timestamp, --minimum time of scheduling to still be valid
    duration interval, --size on schedule
    completed boolean default false not null, --was it completed?
    priority int default 0 not null --marker for ordering in task lists
);
create index idx_tasks_scheduled on tasks(user_id, scheduled_timestamp);
create index idx_tasks_todo on tasks(user_id, min_timestamp, max_timestamp, completed);
create index idx_tasks_effort on tasks(effort_id);
