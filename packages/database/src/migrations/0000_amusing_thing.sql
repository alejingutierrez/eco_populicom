CREATE TYPE "public"."user_role" AS ENUM('admin', 'analyst', 'viewer');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"brandwatch_project_id" bigint,
	"brandwatch_query_ids" jsonb,
	"logo_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"mention_ids" jsonb,
	"details" jsonb,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"notify_emails" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_mentions" integer DEFAULT 0 NOT NULL,
	"positive_count" integer DEFAULT 0 NOT NULL,
	"neutral_count" integer DEFAULT 0 NOT NULL,
	"negative_count" integer DEFAULT 0 NOT NULL,
	"high_pertinence_count" integer DEFAULT 0 NOT NULL,
	"total_likes" integer DEFAULT 0 NOT NULL,
	"total_comments" integer DEFAULT 0 NOT NULL,
	"total_shares" integer DEFAULT 0 NOT NULL,
	"total_reach" bigint DEFAULT 0 NOT NULL,
	"total_impact" double precision DEFAULT 0 NOT NULL,
	"total_engagement_score" double precision DEFAULT 0 NOT NULL,
	"nss" double precision,
	"brand_health_index" double precision,
	"reputation_momentum" double precision,
	"engagement_rate" double precision,
	"amplification_rate" double precision,
	"engagement_velocity" double precision,
	"crisis_risk_score" double precision,
	"volume_anomaly_zscore" double precision,
	"nss_7d" double precision,
	"nss_30d" double precision,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_metrics_agency_date" UNIQUE("agency_id","date")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cognito_sub" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"role" "user_role" NOT NULL,
	"agency_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_cognito_sub_unique" UNIQUE("cognito_sub")
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"bw_resource_id" varchar(255) NOT NULL,
	"bw_guid" varchar(255),
	"bw_query_id" bigint NOT NULL,
	"bw_query_name" varchar(255),
	"title" text,
	"snippet" text,
	"url" text,
	"original_url" text,
	"author" varchar(255),
	"author_fullname" varchar(255),
	"author_gender" varchar(20),
	"author_avatar_url" text,
	"domain" varchar(255),
	"page_type" varchar(50) NOT NULL,
	"content_source" varchar(50),
	"content_source_name" varchar(100),
	"pub_type" varchar(50),
	"subtype" varchar(50),
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"engagement_score" double precision DEFAULT 0 NOT NULL,
	"impact" double precision DEFAULT 0 NOT NULL,
	"reach_estimate" integer DEFAULT 0 NOT NULL,
	"potential_audience" integer DEFAULT 0 NOT NULL,
	"monthly_visitors" bigint DEFAULT 0 NOT NULL,
	"bw_country" varchar(100),
	"bw_country_code" varchar(10),
	"bw_region" varchar(100),
	"bw_city" varchar(100),
	"bw_city_code" varchar(100),
	"bw_sentiment" varchar(20),
	"nlp_sentiment" varchar(20),
	"nlp_emotions" jsonb,
	"nlp_pertinence" varchar(10),
	"nlp_summary" text,
	"text_hash" varchar(64),
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"duplicate_of_id" uuid,
	"media_urls" jsonb,
	"has_image" boolean DEFAULT false NOT NULL,
	"has_video" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"language" varchar(10) DEFAULT 'es' NOT NULL,
	CONSTRAINT "mentions_bw_resource_id_unique" UNIQUE("bw_resource_id")
);
--> statement-breakpoint
CREATE TABLE "mention_municipalities" (
	"mention_id" uuid NOT NULL,
	"municipality_id" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	CONSTRAINT "mention_municipalities_mention_id_municipality_id_pk" PRIMARY KEY("mention_id","municipality_id")
);
--> statement-breakpoint
CREATE TABLE "mention_topics" (
	"mention_id" uuid NOT NULL,
	"topic_id" integer NOT NULL,
	"subtopic_id" integer,
	"confidence" double precision NOT NULL,
	CONSTRAINT "mention_topics_mention_id_topic_id_pk" PRIMARY KEY("mention_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "subtopics" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_subtopic_topic_slug" UNIQUE("topic_id","slug")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_topic_agency_slug" UNIQUE("agency_id","slug")
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"region" varchar(50) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"population" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "municipalities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ingestion_cursors" (
	"query_id" bigint PRIMARY KEY NOT NULL,
	"last_mention_date" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"mentions_fetched" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'idle' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_configs" (
	"agency_id" uuid PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"send_hour_local" integer DEFAULT 16 NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Bogota' NOT NULL,
	"template_key" varchar(64) DEFAULT 'weekly-sentiment-summary' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_email" varchar(255) DEFAULT 'agutierrez@populicom.com' NOT NULL,
	"from_name" varchar(255) DEFAULT 'Populicom Radar' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipients" jsonb NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"template_key" varchar(64) NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"message_id" varchar(255),
	"error" text,
	"stats" jsonb,
	"triggered_by" uuid
);
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metric_snapshots" ADD CONSTRAINT "daily_metric_snapshots_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_municipalities" ADD CONSTRAINT "mention_municipalities_mention_id_mentions_id_fk" FOREIGN KEY ("mention_id") REFERENCES "public"."mentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_municipalities" ADD CONSTRAINT "mention_municipalities_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_topics" ADD CONSTRAINT "mention_topics_mention_id_mentions_id_fk" FOREIGN KEY ("mention_id") REFERENCES "public"."mentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_topics" ADD CONSTRAINT "mention_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_topics" ADD CONSTRAINT "mention_topics_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtopics" ADD CONSTRAINT "subtopics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_configs" ADD CONSTRAINT "report_configs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_configs" ADD CONSTRAINT "report_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_send_log" ADD CONSTRAINT "report_send_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_send_log" ADD CONSTRAINT "report_send_log_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alert_history_agency_id" ON "alert_history" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "idx_alert_rules_agency_id" ON "alert_rules" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "idx_daily_metrics_agency_crisis" ON "daily_metric_snapshots" USING btree ("agency_id","crisis_risk_score");--> statement-breakpoint
CREATE INDEX "idx_mentions_agency_id" ON "mentions" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "idx_mentions_published_at" ON "mentions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_mentions_nlp_sentiment" ON "mentions" USING btree ("nlp_sentiment");--> statement-breakpoint
CREATE INDEX "idx_mentions_page_type" ON "mentions" USING btree ("page_type");--> statement-breakpoint
CREATE INDEX "idx_mentions_text_hash" ON "mentions" USING btree ("text_hash");--> statement-breakpoint
CREATE INDEX "idx_mentions_domain" ON "mentions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_mentions_agency_published" ON "mentions" USING btree ("agency_id","published_at");--> statement-breakpoint
CREATE INDEX "idx_report_configs_active" ON "report_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_report_send_log_agency_id" ON "report_send_log" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "idx_report_send_log_sent_at" ON "report_send_log" USING btree ("sent_at");