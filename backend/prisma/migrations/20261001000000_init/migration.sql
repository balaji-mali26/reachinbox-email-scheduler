-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'RATE_LIMITED_RESCHEDULED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "googleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "minDelayMs" INTEGER NOT NULL DEFAULT 2000,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 100,
    "totalRecipients" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "processingLeaseUntil" TIMESTAMP(3),
    "workerAttempt" INTEGER NOT NULL DEFAULT 0,
    "etherealMessageId" TEXT,
    "etherealPreviewUrl" TEXT,
    "bullmqJobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "encryptedToken" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenTag" TEXT NOT NULL,
    "botUserId" TEXT,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitAudit" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "hourWindow" TEXT NOT NULL,
    "attemptedJobsCount" INTEGER NOT NULL DEFAULT 1,
    "notifiedSlackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Sender_userId_idx" ON "Sender"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_userId_email_key" ON "Sender"("userId", "email");

-- CreateIndex
CREATE INDEX "EmailBatch_userId_idx" ON "EmailBatch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailJob_bullmqJobId_key" ON "EmailJob"("bullmqJobId");

-- CreateIndex
CREATE INDEX "EmailJob_scheduledAt_idx" ON "EmailJob"("scheduledAt");

-- CreateIndex
CREATE INDEX "EmailJob_status_idx" ON "EmailJob"("status");

-- CreateIndex
CREATE INDEX "EmailJob_senderId_scheduledAt_idx" ON "EmailJob"("senderId", "scheduledAt");

-- CreateIndex
CREATE INDEX "EmailJob_processingLeaseUntil_idx" ON "EmailJob"("processingLeaseUntil");

-- CreateIndex
CREATE INDEX "EmailJob_recipientEmail_idx" ON "EmailJob"("recipientEmail");

-- CreateIndex
CREATE UNIQUE INDEX "SlackConnection_userId_key" ON "SlackConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitAudit_senderId_hourWindow_key" ON "RateLimitAudit"("senderId", "hourWindow");

-- AddForeignKey
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBatch" ADD CONSTRAINT "EmailBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBatch" ADD CONSTRAINT "EmailBatch_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EmailBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackConnection" ADD CONSTRAINT "SlackConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
