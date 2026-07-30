-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ArchiveSource" AS ENUM ('GMAIL_AUTO', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('AWAITING_FIRST_INSTALLMENT', 'FIRST_INSTALLMENT_INGESTED', 'AWAITING_SECOND_INSTALLMENT', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "IntakeArea" AS ENUM ('WHO_THEY_ARE', 'WHERE_THEY_ARE_TODAY', 'WHERE_THEY_WANT_TO_BE', 'WHO_THEY_REACH', 'VOICE_AND_CONSTRAINTS');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('IN_PROGRESS', 'COMPLETE', 'ABANDONED');

-- CreateEnum
CREATE TYPE "NetworkDensity" AS ENUM ('SPARSE', 'MODERATE', 'DENSE');

-- CreateEnum
CREATE TYPE "IntelTier" AS ENUM ('SEARCH_INDEX', 'USER_SEEDED', 'PUBLIC_SCRAPE');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'IN_REFINEMENT', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "EngagementKind" AS ENUM ('COMMENT', 'REACTION');

-- CreateEnum
CREATE TYPE "ConfidenceCategory" AS ENUM ('TOPIC', 'ANGLE', 'TONE', 'FORMAT', 'CADENCE', 'ENGAGEMENT_TARGET', 'OUTREACH');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'REJECT', 'EDIT');

-- CreateEnum
CREATE TYPE "AutonomousOutcome" AS ENUM ('PUBLISHED', 'BLOCKED_KILL_SWITCH', 'BLOCKED_CAP', 'BLOCKED_CONFIDENCE', 'BLOCKED_ALLOWLIST', 'BLOCKED_CONSTRAINT', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('IDENTIFIED', 'DRAFTED', 'SENT_BY_USER', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AudienceAxis" AS ENUM ('CUSTOMER', 'OPERATOR', 'PEER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('GOOGLE_DRIVE', 'UPLOAD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedinSub" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "pictureUrl" TEXT,
    "accessTokenCipher" TEXT NOT NULL,
    "refreshTokenCipher" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "refreshFailureCount" INTEGER NOT NULL DEFAULT 0,
    "scopes" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "LinkedInAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT,
    "accessTokenCipher" TEXT NOT NULL,
    "refreshTokenCipher" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "gmailWatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "driveWatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ArchiveSource" NOT NULL,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'AWAITING_FIRST_INSTALLMENT',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstInstallmentAt" TIMESTAMP(3),
    "secondInstallmentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gmailMessageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileReport" JSONB,
    "error" TEXT,
    "previousSnapshotId" TEXT,

    CONSTRAINT "ArchiveSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "company" TEXT,
    "position" TEXT,
    "profileUrl" TEXT,
    "connectedOn" TIMESTAMP(3),
    "normalizedName" TEXT,
    "normalizedCompany" TEXT,
    "personaFitScore" DOUBLE PRECISION,
    "personaFitReason" TEXT,
    "scoredAgainstBriefId" TEXT,
    "rawRow" JSONB NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "shareLink" TEXT,
    "publishedAt" TIMESTAMP(3),
    "content" TEXT,
    "visibility" TEXT,
    "mediaUrl" TEXT,
    "rawRow" JSONB NOT NULL,

    CONSTRAINT "ShareRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "title" TEXT,
    "publishedAt" TIMESTAMP(3),
    "content" TEXT,
    "sourceFile" TEXT,

    CONSTRAINT "ArticleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "postUrl" TEXT,
    "createdAt" TIMESTAMP(3),
    "message" TEXT,
    "rawRow" JSONB NOT NULL,

    CONSTRAINT "CommentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "conversationId" TEXT,
    "fromName" TEXT,
    "toName" TEXT,
    "sentAt" TIMESTAMP(3),
    "content" TEXT,
    "direction" TEXT,
    "usableForAnalysis" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MessageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "fromName" TEXT,
    "toName" TEXT,
    "sentAt" TIMESTAMP(3),
    "direction" TEXT,
    "status" TEXT,
    "message" TEXT,

    CONSTRAINT "InvitationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "seededFromSnapshotId" TEXT,

    CONSTRAINT "IntakeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeSlot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "area" "IntakeArea" NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "criteria" JSONB NOT NULL,
    "metCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data" JSONB,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntakeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "area" "IntakeArea",
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicBrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sessionId" TEXT,
    "role" TEXT,
    "industry" TEXT,
    "niche" TEXT,
    "subNiche" TEXT,
    "offer" TEXT,
    "currentState" JSONB,
    "targetState" JSONB,
    "persona" JSONB,
    "voiceProfileSummary" TEXT,
    "neverSay" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "complianceFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supersededById" TEXT,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roadmap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "connectionCount" INTEGER,
    "density" "NetworkDensity",
    "audienceFitRatio" DOUBLE PRECISION,
    "invitationAcceptRate" DOUBLE PRECISION,
    "historicalCadence" JSONB,
    "networkAnalysis" JSONB,
    "trendAnalysis" JSONB,
    "peerAnalysis" JSONB,
    "summary" TEXT,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapElement" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "businessGoal" TEXT,
    "audienceSegment" TEXT,
    "targetFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL,

    CONSTRAINT "RoadmapElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Peer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "company" TEXT,
    "otherChannels" JSONB,
    "seededByUser" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Peer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerPost" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "IntelTier" NOT NULL,
    "url" TEXT,
    "content" TEXT,
    "publishedAt" TIMESTAMP(3),
    "format" TEXT,
    "reactionCount" INTEGER,
    "commentCount" INTEGER,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,

    CONSTRAINT "PeerPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roadmapElementId" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT NOT NULL,
    "format" TEXT,
    "whyThis" TEXT,
    "similarityScore" DOUBLE PRECISION,
    "similarityMatchUrl" TEXT,
    "voiceProfileId" TEXT,
    "generationId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "linkedinUrn" TEXT,
    "publishError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftRevision" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "instruction" TEXT,
    "diff" JSONB,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "authorName" TEXT,
    "authorUrl" TEXT,
    "postContent" TEXT,
    "postedAt" TIMESTAMP(3),
    "tier" "IntelTier" NOT NULL,
    "priorityScore" DOUBLE PRECISION,
    "authorFit" DOUBLE PRECISION,
    "audienceOverlap" DOUBLE PRECISION,
    "freshness" DOUBLE PRECISION,
    "scoreRationale" TEXT,
    "actedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "roadmapElementId" TEXT,
    "kind" "EngagementKind" NOT NULL DEFAULT 'COMMENT',
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT,
    "reactionType" TEXT,
    "whyThis" TEXT,
    "voiceProfileId" TEXT,
    "generationId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "linkedinUrn" TEXT,
    "publishError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DecisionType" NOT NULL,
    "category" "ConfidenceCategory" NOT NULL,
    "contentDraftId" TEXT,
    "engagementDraftId" TEXT,
    "reason" TEXT,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceAxis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "ConfidenceCategory" NOT NULL,
    "score" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "minSampleSize" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfidenceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceEvent" (
    "id" TEXT NOT NULL,
    "scoreId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT,
    "fromScore" DOUBLE PRECISION,
    "toScore" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "traits" JSONB NOT NULL,
    "summary" TEXT,
    "sourceCommentCount" INTEGER NOT NULL DEFAULT 0,
    "sourceShareCount" INTEGER NOT NULL DEFAULT 0,
    "sourceEditCount" INTEGER NOT NULL DEFAULT 0,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "qualifiedConversations" INTEGER,
    "profileViews" INTEGER,
    "inboundFromPersona" INTEGER,
    "audienceFitRatioDelta" DOUBLE PRECISION,
    "personaCommentsReceived" INTEGER,
    "postEngagement" JSONB,
    "editsPerDraft" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomySettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engagementAutonomyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contentAutonomyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyEngagementCap" INTEGER NOT NULL DEFAULT 5,
    "dailyContentCap" INTEGER NOT NULL DEFAULT 1,
    "targetAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requireAllowlist" BOOLEAN NOT NULL DEFAULT true,
    "topicExclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "killSwitchEngagedAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomousAction" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" "AutonomousOutcome" NOT NULL,
    "reason" TEXT,
    "contentDraftId" TEXT,
    "engagementDraftId" TEXT,
    "confidenceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutonomousAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT,
    "company" TEXT,
    "profileUrl" TEXT,
    "roadmapElementId" TEXT,
    "personaFit" DOUBLE PRECISION,
    "rationale" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "draftMessage" TEXT,
    "generationId" TEXT,
    "sentAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "subjectUrl" TEXT,
    "connectionId" TEXT,
    "axis" "AudienceAxis" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "evidence" TEXT,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "summary" TEXT,
    "excerpts" JSONB,
    "extractedInsights" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "promptName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "output" TEXT,
    "outputJson" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_userId_key" ON "LinkedInAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_linkedinSub_key" ON "LinkedInAccount"("linkedinSub");

-- CreateIndex
CREATE INDEX "LinkedInAccount_accessTokenExpiresAt_idx" ON "LinkedInAccount"("accessTokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_userId_key" ON "GoogleAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_googleSub_key" ON "GoogleAccount"("googleSub");

-- CreateIndex
CREATE INDEX "ArchiveSnapshot_userId_requestedAt_idx" ON "ArchiveSnapshot"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "Connection_userId_snapshotId_idx" ON "Connection"("userId", "snapshotId");

-- CreateIndex
CREATE INDEX "Connection_userId_normalizedCompany_idx" ON "Connection"("userId", "normalizedCompany");

-- CreateIndex
CREATE INDEX "Connection_userId_personaFitScore_idx" ON "Connection"("userId", "personaFitScore");

-- CreateIndex
CREATE INDEX "ShareRecord_userId_publishedAt_idx" ON "ShareRecord"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "ArticleRecord_userId_publishedAt_idx" ON "ArticleRecord"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "CommentRecord_userId_createdAt_idx" ON "CommentRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageRecord_userId_conversationId_idx" ON "MessageRecord"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "MessageRecord_userId_sentAt_idx" ON "MessageRecord"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "InvitationRecord_userId_sentAt_idx" ON "InvitationRecord"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "IntakeSession_userId_status_idx" ON "IntakeSession"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeSlot_sessionId_area_key" ON "IntakeSlot"("sessionId", "area");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeTurn_sessionId_index_key" ON "IntakeTurn"("sessionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicBrief_sessionId_key" ON "StrategicBrief"("sessionId");

-- CreateIndex
CREATE INDEX "StrategicBrief_userId_createdAt_idx" ON "StrategicBrief"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicBrief_userId_version_key" ON "StrategicBrief"("userId", "version");

-- CreateIndex
CREATE INDEX "Roadmap_userId_createdAt_idx" ON "Roadmap"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Roadmap_userId_version_key" ON "Roadmap"("userId", "version");

-- CreateIndex
CREATE INDEX "RoadmapElement_roadmapId_phase_order_idx" ON "RoadmapElement"("roadmapId", "phase", "order");

-- CreateIndex
CREATE INDEX "Peer_userId_active_idx" ON "Peer"("userId", "active");

-- CreateIndex
CREATE INDEX "PeerPost_userId_publishedAt_idx" ON "PeerPost"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "PeerPost_peerId_publishedAt_idx" ON "PeerPost"("peerId", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentDraft_userId_status_idx" ON "ContentDraft"("userId", "status");

-- CreateIndex
CREATE INDEX "ContentDraft_userId_scheduledFor_idx" ON "ContentDraft"("userId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DraftRevision_draftId_index_key" ON "DraftRevision"("draftId", "index");

-- CreateIndex
CREATE INDEX "EngagementTarget_userId_priorityScore_idx" ON "EngagementTarget"("userId", "priorityScore");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementTarget_userId_postUrl_key" ON "EngagementTarget"("userId", "postUrl");

-- CreateIndex
CREATE INDEX "EngagementDraft_userId_status_idx" ON "EngagementDraft"("userId", "status");

-- CreateIndex
CREATE INDEX "Decision_userId_category_createdAt_idx" ON "Decision"("userId", "category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidenceScore_userId_category_key" ON "ConfidenceScore"("userId", "category");

-- CreateIndex
CREATE INDEX "ConfidenceEvent_userId_createdAt_idx" ON "ConfidenceEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_userId_version_key" ON "VoiceProfile"("userId", "version");

-- CreateIndex
CREATE INDEX "MetricReport_userId_periodStart_idx" ON "MetricReport"("userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AutonomySettings_userId_key" ON "AutonomySettings"("userId");

-- CreateIndex
CREATE INDEX "AutonomousAction_userId_createdAt_idx" ON "AutonomousAction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectTarget_userId_status_idx" ON "ProspectTarget"("userId", "status");

-- CreateIndex
CREATE INDEX "ProspectTarget_userId_personaFit_idx" ON "ProspectTarget"("userId", "personaFit");

-- CreateIndex
CREATE INDEX "AudienceSignal_userId_axis_idx" ON "AudienceSignal"("userId", "axis");

-- CreateIndex
CREATE INDEX "SourceDocument_userId_confirmedAt_idx" ON "SourceDocument"("userId", "confirmedAt");

-- CreateIndex
CREATE INDEX "Generation_userId_purpose_createdAt_idx" ON "Generation"("userId", "purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveSnapshot" ADD CONSTRAINT "ArchiveSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareRecord" ADD CONSTRAINT "ShareRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareRecord" ADD CONSTRAINT "ShareRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRecord" ADD CONSTRAINT "ArticleRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRecord" ADD CONSTRAINT "ArticleRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentRecord" ADD CONSTRAINT "CommentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentRecord" ADD CONSTRAINT "CommentRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecord" ADD CONSTRAINT "MessageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecord" ADD CONSTRAINT "MessageRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationRecord" ADD CONSTRAINT "InvitationRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationRecord" ADD CONSTRAINT "InvitationRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArchiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSession" ADD CONSTRAINT "IntakeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSlot" ADD CONSTRAINT "IntakeSlot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeTurn" ADD CONSTRAINT "IntakeTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicBrief" ADD CONSTRAINT "StrategicBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicBrief" ADD CONSTRAINT "StrategicBrief_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntakeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roadmap" ADD CONSTRAINT "Roadmap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roadmap" ADD CONSTRAINT "Roadmap_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "StrategicBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapElement" ADD CONSTRAINT "RoadmapElement_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Peer" ADD CONSTRAINT "Peer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerPost" ADD CONSTRAINT "PeerPost_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "Peer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_roadmapElementId_fkey" FOREIGN KEY ("roadmapElementId") REFERENCES "RoadmapElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftRevision" ADD CONSTRAINT "DraftRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementTarget" ADD CONSTRAINT "EngagementTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementDraft" ADD CONSTRAINT "EngagementDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementDraft" ADD CONSTRAINT "EngagementDraft_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "EngagementTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementDraft" ADD CONSTRAINT "EngagementDraft_roadmapElementId_fkey" FOREIGN KEY ("roadmapElementId") REFERENCES "RoadmapElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_contentDraftId_fkey" FOREIGN KEY ("contentDraftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_engagementDraftId_fkey" FOREIGN KEY ("engagementDraftId") REFERENCES "EngagementDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceScore" ADD CONSTRAINT "ConfidenceScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceEvent" ADD CONSTRAINT "ConfidenceEvent_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "ConfidenceScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricReport" ADD CONSTRAINT "MetricReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomySettings" ADD CONSTRAINT "AutonomySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomousAction" ADD CONSTRAINT "AutonomousAction_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "AutonomySettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectTarget" ADD CONSTRAINT "ProspectTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceSignal" ADD CONSTRAINT "AudienceSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

