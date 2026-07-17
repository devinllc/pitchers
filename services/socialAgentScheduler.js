/**
 * Social Agent Scheduler — Production Grade
 *
 * POST SCHEDULER: Every minute, fires within ±4 min of user-configured times.
 *
 * PR LOOP: Continuous per-agent background loop.
 *   - Starts when marketing_enabled = true (checked every 5 min)
 *   - Runs a PR action, then waits a random human-like break (20–60 min)
 *   - Stops when marketing_enabled is turned off
 *   - Multiple agents each get their own independent loop
 */

const DatabaseService = require('./database');
const SocialMediaAgentService = require('./socialMediaAgentService');
const SocialPuppeteerService = require('./socialPuppeteerService');
const cron = require('node-cron');

class SocialAgentScheduler {
  constructor() {
    this.db = new DatabaseService();
    this.cronTask = null;
    this.isRunning = false;

    // Per-agent PR loop tracking: key = `platform:userEmail`
    // Value: { running: bool, cancelFn: fn }
    this.prLoops = new Map();
    this.prLoopCheckTask = null;
  }

  // ── Start / Stop ──────────────────────────────────────────────────────────

  start() {
    if (this.cronTask) return;
    console.log(`⏰ [SocialScheduler] Background worker started`);

    // Post scheduler: every minute
    this.cronTask = cron.schedule('* * * * *', () => {
      this.pollAndExecute().catch(err =>
        console.error('❌ [SocialScheduler] Poll error:', err.message)
      );
    });

    // PR loop manager: checks every 3 minutes which agents need PR loops started/stopped
    this.prLoopCheckTask = cron.schedule('*/3 * * * *', () => {
      this.syncPRLoops().catch(err =>
        console.error('❌ [SocialScheduler:PR] Sync error:', err.message)
      );
    });

    // Initial checks after boot
    setTimeout(() => {
      this.pollAndExecute().catch(() => {});
    }, 10000);

    // Initial PR loop sync: run at 3s, 30s, and 90s after boot to handle late session restores
    [3000, 30000, 90000].forEach(delay => {
      setTimeout(() => {
        this.syncPRLoops().catch(err =>
          console.error(`❌ [SocialScheduler:PR] Startup sync (${delay}ms) error:`, err.message)
        );
      }, delay);
    });
  }

  stop() {
    if (this.cronTask) { this.cronTask.stop(); this.cronTask = null; }
    if (this.prLoopCheckTask) { this.prLoopCheckTask.stop(); this.prLoopCheckTask = null; }
    // Cancel all running PR loops
    for (const [key, loop] of this.prLoops) {
      loop.cancel = true;
      console.log(`⏰ [SocialScheduler:PR] Loop cancelled for ${key}`);
    }
    this.prLoops.clear();
    console.log('⏰ [SocialScheduler] Stopped.');
  }

  // ── PR Loop Manager ───────────────────────────────────────────────────────

  /**
   * syncPRLoops: Called every 5 min.
   * - Starts a continuous PR loop for any agent with marketing_enabled = true that doesn't have one
   * - Cancels loops for agents that have turned off marketing
   */
  async syncPRLoops() {
    try {
      await this.db.connect().catch(() => {});
      const { rows } = await this.db.pool.query(
        `SELECT * FROM social_media_agents WHERE enabled = true`
      );

      const activeMarketingKeys = new Set();

      for (const agent of rows) {
        const key = `${agent.platform}:${agent.user_email}`;

        if (agent.marketing_enabled) {
          activeMarketingKeys.add(key);
          if (!this.prLoops.has(key)) {
            console.log(`🚀 [SocialScheduler:PR] Starting loop for ${key}`);
            this._startPRLoop(agent);
          } else {
            console.log(`✅ [SocialScheduler:PR] Loop already running for ${key}`);
          }
        } else {
          console.log(`⏸️ [SocialScheduler:PR] marketing_enabled=false for ${key}, skipping`);
        }
      }

      // Cancel loops for agents that disabled marketing
      for (const [key, loopState] of this.prLoops) {
        if (!activeMarketingKeys.has(key)) {
          loopState.cancel = true;
          this.prLoops.delete(key);
          console.log(`⏰ [SocialScheduler:PR] Stopping loop for ${key} (marketing disabled)`);
        }
      }
    } catch (err) {
      console.error('❌ [SocialScheduler:PR] syncPRLoops error:', err.message);
    }
  }

  /**
   * _startPRLoop: Launches an async loop for one agent.
   * Runs PR → waits random break → repeats, until cancelled.
   */
  _startPRLoop(agent) {
    const key = `${agent.platform}:${agent.user_email}`;
    const loopState = { cancel: false };
    this.prLoops.set(key, loopState);

    console.log(`🔄 [SocialScheduler:PR] Loop STARTED for ${key}`);

    const loop = async () => {
      let iteration = 0;
      while (!loopState.cancel) {
        iteration++;
        try {
          // Re-check that agent still has marketing enabled and is connected
          await this.db.connect().catch(() => {});
          const { rows } = await this.db.pool.query(
            `SELECT marketing_enabled, niche FROM social_media_agents WHERE platform = $1 AND user_email = $2 LIMIT 1`,
            [agent.platform, agent.user_email]
          );
          if (!rows[0]?.marketing_enabled) {
            console.log(`[SocialScheduler:PR] Marketing disabled for ${key}, stopping loop`);
            loopState.cancel = true;
            this.prLoops.delete(key);
            break;
          }

          const niche = rows[0].niche || agent.niche;
          const socialSvc = SocialPuppeteerService.getInstance();
          const status = socialSvc.getStatus(agent.platform, agent.user_email);

          console.log(`🔄 [SocialScheduler:PR] Iteration #${iteration} for ${key} | connected=${status.connected}`);

          if (!status.connected) {
            console.warn(`⚠️ [SocialScheduler:PR] ${agent.platform} session not ready for ${agent.user_email}. Will retry after short break.`);
            // Short retry break of 5 min when not connected
            await this._sleep(5 * 60 * 1000, loopState);
            continue;
          }

          // Enforce strict daily caps to prevent account bans (Twitter/LinkedIn: 5/day, Others: 10/day)
          const countResult = await this.db.pool.query(
            `SELECT COUNT(*) as count FROM social_pr_comments
             WHERE user_email = $1 AND platform = $2 AND status = 'posted'
               AND created_at >= CURRENT_DATE`,
            [agent.user_email, agent.platform]
          );
          const sentToday = parseInt(countResult.rows[0]?.count || 0);
          const dailyLimit = (agent.platform === 'twitter' || agent.platform === 'linkedin') ? 5 : 10;

          if (sentToday >= dailyLimit) {
            console.log(`🛡️ [SocialScheduler:PR] Daily limit of ${dailyLimit} reached for ${key} (${sentToday} sent today). Sleeping for 2 hours.`);
            await this._sleep(2 * 60 * 60 * 1000, loopState); // Sleep for 2 hours
            continue;
          }

          const agentSvc = SocialMediaAgentService.getInstance();
          await agentSvc.executeSocialMarketingPR(agent.platform, agent.user_email, niche)
            .catch(err => console.warn(`[SocialScheduler:PR] PR error for ${key}:`, err.message));
        } catch (err) {
          console.warn(`[SocialScheduler:PR] Loop iteration error for ${key}:`, err.message);
        }

        if (loopState.cancel) break;

        // Long, safe, human-like breaks to bypass automation detection
        // Twitter/X and LinkedIn: 90–180 minutes (1.5 to 3 hours)
        // Others (Reddit/Instagram): 45–90 minutes
        let breakMin = 45 + Math.floor(Math.random() * 45); // Default 45-90 min
        if (agent.platform === 'twitter' || agent.platform === 'linkedin') {
          breakMin = 90 + Math.floor(Math.random() * 90); // 90-180 min
        }
        
        console.log(`⏳ [SocialScheduler:PR] Next PR action for ${key} in ${breakMin} min (Today's count: ${sentToday + 1})`);
        await this._sleep(breakMin * 60 * 1000, loopState);
      }
      console.log(`🛑 [SocialScheduler:PR] Loop ended for ${key}`);
    };

    loop().catch(err => {
      console.error(`❌ [SocialScheduler:PR] Loop crashed for ${key}:`, err.message);
      this.prLoops.delete(key);
    });
  }

  /**
   * Sleep that can be interrupted by loopState.cancel
   */
  _sleep(ms, loopState) {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (loopState.cancel) { clearInterval(interval); resolve(); }
      }, 5000);
      setTimeout(() => { clearInterval(interval); resolve(); }, ms);
    });
  }

  // ── Post Scheduler ────────────────────────────────────────────────────────

  async pollAndExecute() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.db.connect().catch(() => {});
      const now = new Date();
      const nowHour = now.getHours();
      const nowMin = now.getMinutes();

      const { rows: activeAgents } = await this.db.pool.query(
        `SELECT * FROM social_media_agents WHERE enabled = true`
      );
      if (activeAgents.length === 0) return;

      console.log(`⏰ [SocialScheduler] Found ${activeAgents.length} active agent(s). Time: ${String(nowHour).padStart(2,'0')}:${String(nowMin).padStart(2,'0')}`);

      for (const agent of activeAgents) {
        try {
          const scheduleTimes = (agent.schedule_time || '09:00')
            .split(',')
            .map(t => t.trim())
            .filter(t => /^\d{2}:\d{2}$/.test(t));

          for (const sTime of scheduleTimes) {
            const [hour, minute] = sTime.split(':').map(Number);
            const diffMin = (nowHour * 60 + nowMin) - (hour * 60 + minute);
            if (diffMin < 0 || diffMin > 4) continue;

            // Check if already posted today for this slot
            const { rows } = await this.db.pool.query(`
              SELECT EXISTS (
                SELECT 1 FROM social_media_posts
                WHERE user_email = $1
                  AND platform = $2
                  AND status = 'published'
                  AND published_at::date = CURRENT_DATE
                  AND ABS(EXTRACT(EPOCH FROM (published_at - (CURRENT_DATE + $3::interval))) / 60) < 15
              )
            `, [agent.user_email, agent.platform, `${hour} hours ${minute} minutes`]);

            if (rows[0].exists) {
              console.log(`⏰ [SocialScheduler] Already posted for slot ${sTime}. Skipping.`);
              continue;
            }

            const socialSvc = SocialPuppeteerService.getInstance();
            if (!socialSvc.getStatus(agent.platform, agent.user_email).connected) {
              console.warn(`⚠️ [SocialScheduler] ${agent.platform} not connected. Slot: ${sTime}`);
              continue;
            }

            console.log(`⚡ [SocialScheduler] Triggering: ${agent.user_email} / ${agent.platform} / slot ${sTime}`);
            await this.triggerAgentPost(agent);
            break;
          }
        } catch (agentErr) {
          console.error(`❌ [SocialScheduler] Agent error (${agent.user_email}/${agent.platform}):`, agentErr.message);
        }
      }
    } catch (err) {
      console.error('❌ [SocialScheduler] DB poll failed:', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  async triggerAgentPost(agent) {
    const { user_email, platform, niche, tone } = agent;
    const agentSvc = SocialMediaAgentService.getInstance();

    const { rows } = await this.db.pool.query(
      `INSERT INTO social_media_posts (user_email, platform, post_text, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [user_email, platform, 'Generating AI content...', 'publishing']
    );
    const postId = rows[0].id;

    try {
      const result = await agentSvc.executeAutoPost(platform, user_email, niche, tone);
      await this.db.pool.query(
        `UPDATE social_media_posts SET post_text = $1, image_url = $2, status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $3`,
        [result.postText, result.imageUrl || null, postId]
      );
      await this.db.pool.query(
        `UPDATE social_media_agents SET last_posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [agent.id]
      );
      console.log(`✅ [SocialScheduler] Auto-post done for ${user_email} / ${platform}`);
    } catch (err) {
      await this.db.pool.query(
        `UPDATE social_media_posts SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [err.message || String(err), postId]
      );
      console.error(`❌ [SocialScheduler] Post failed (${user_email}/${platform}):`, err.message);
    }
  }
}

module.exports = new SocialAgentScheduler();
