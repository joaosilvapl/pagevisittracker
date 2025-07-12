const BLOCK_RULE_ID_OFFSET = 1000;

let temporaryAllowAccess = {};

const DEFAULT_TRACKED_PAGES = [{ url: 'https://www.bbc.com/', minutesSinceLastVisit: 5 }];
let currentTrackedPages = [];

async function loadTrackedPages() {
    const items = await chrome.storage.sync.get({ trackedPages: DEFAULT_TRACKED_PAGES });
    currentTrackedPages = items.trackedPages;
    console.log(`[Background] Tracking these URLs with time limits:`, currentTrackedPages);
    await checkAllVisitTimesAndManageRules();
}

// Function to update declarativeNetRequest rules for all tracked pages
async function updateRedirectionRulesForAll() {
    const rulesToAdd = [];
    const ruleIdsToRemove = []; // List of rule IDs currently active that we manage

    // Get all existing dynamic rules managed by this extension
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    existingRules.forEach(rule => {
        if (rule.id >= BLOCK_RULE_ID_OFFSET && rule.id < BLOCK_RULE_ID_OFFSET + currentTrackedPages.length) {
            ruleIdsToRemove.push(rule.id);
        }
    });

    for (let i = 0; i < currentTrackedPages.length; i++) {
        const page = currentTrackedPages[i];
        const ruleId = BLOCK_RULE_ID_OFFSET + i;

        const storageKey = 'last_visit_timestamp_' + encodeURIComponent(page.url);
        const result = await chrome.storage.local.get(storageKey);
        const lastVisitTimestamp = result[storageKey] || 0;

        const now = Date.now();
        const minutesThresholdMs = page.minutesSinceLastVisit * 60 * 1000;

        const timeElapsedSinceLastVisit = now - lastVisitTimestamp;
        // Block if it's not the first visit AND time elapsed is LESS than the required threshold
        const shouldBlock = (lastVisitTimestamp !== 0 && timeElapsedSinceLastVisit < minutesThresholdMs);

        console.log(`[Background] Evaluating: ${page.url}, Last Visit: ${lastVisitTimestamp > 0 ? new Date(lastVisitTimestamp).toLocaleTimeString() : 'Never'}, Time Elapsed: ${Math.round(timeElapsedSinceLastVisit / 1000)}s, Required: ${minutesThresholdMs / 1000}s`);

        if (shouldBlock) {
            rulesToAdd.push({
                id: ruleId,
                priority: 1,
                action: {
                    type: "redirect",
                    redirect: { url: chrome.runtime.getURL(`blocked_page.html?originalUrl=${encodeURIComponent(page.url)}`) }
                },
                condition: {
                    urlFilter: page.url + "*",
                    resourceTypes: ["main_frame"]
                }
            });
            console.log(`[Background] Rule ${ruleId} will BLOCK ${page.url}. (Time not elapsed)`);
        } else {
             console.log(`[Background] Rule ${ruleId} will NOT block ${page.url}. (Time elapsed or first visit)`);
        }
    }

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ruleIdsToRemove, // Remove all our rules first
            addRules: rulesToAdd            // Then add back only the ones that should be active
        });
        console.log(`[Background] Dynamic rules updated successfully. Rules added: ${rulesToAdd.length}`);
    } catch (error) {
        console.error("[Background] Error updating declarativeNetRequest rules:", error);
    }
}

async function checkAllVisitTimesAndManageRules() {
    await updateRedirectionRulesForAll();
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only proceed for complete main frame navigations to HTTP/HTTPS URLs
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        let matchedPage = null;

        for (const page of currentTrackedPages) {
            if (tab.url.startsWith(page.url)) {
                matchedPage = page;
                break;
            }
        }

        if (matchedPage) {
            const allowance = temporaryAllowAccess[tabId];
            const now = Date.now();

            if (allowance && allowance.url === matchedPage.url && now < allowance.expires) {
                // This navigation is covered by a valid temporary allowance.
                console.log(`[Background] Tab ${tabId} has active temporary allowance for ${matchedPage.url}. Skipping visit timestamp update.`);
                // IMPORTANT: Delete the allowance *after* it has been successfully used for navigation.
                delete temporaryAllowAccess[tabId];
                return; // Do not process this as a regular visit that resets the timer.
            }

            // If no allowance, or allowance expired/didn't match, proceed to update last visit time
            const storageKey = 'last_visit_timestamp_' + encodeURIComponent(matchedPage.url);
            await chrome.storage.local.set({ [storageKey]: Date.now() });
            console.log(`[Background] Last visit timestamp updated for ${matchedPage.url} (regular visit).`);

            // After updating the timestamp, re-evaluate all rules.
            // This will make the page blocked again if the user immediately tries to visit it within the cooldown.
            await checkAllVisitTimesAndManageRules();
        } else {
            // If navigating to a non-tracked URL, or leaving a tracked one, ensure rules are updated.
            await updateRedirectionRulesForAll();
        }
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    await loadTrackedPages();
    const allStorage = await chrome.storage.local.get(null);
    for (const key in allStorage) {
        if (key.startsWith('visit_timestamps_') || key.startsWith('last_visit_timestamp_')) {
            chrome.storage.local.remove(key);
        }
    }
    await checkAllVisitTimesAndManageRules();
});

chrome.storage.sync.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'sync' && changes.trackedPages) {
        await loadTrackedPages();
    }
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === "close_current_tab_from_blocked_page") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id);
        }
    } else if (message.type === "allow_access_to_url") {
        if (sender.tab && sender.tab.id && message.url) {
            const tabId = sender.tab.id;
            const originalUrl = message.url;

            // Step 1: Immediately remove the specific blocking rule for this URL.
            // This is the key to ensuring the next navigation attempt is not blocked.
            const pageIndex = currentTrackedPages.findIndex(p => p.url === originalUrl);
            if (pageIndex !== -1) {
                const ruleIdToBypass = BLOCK_RULE_ID_OFFSET + pageIndex;
                try {
                    await chrome.declarativeNetRequest.updateDynamicRules({
                        removeRuleIds: [ruleIdToBypass]
                    });
                    console.log(`[Background] Explicitly removed blocking rule ${ruleIdToBypass} for ${originalUrl}.`);
                } catch (error) {
                    console.error(`[Background] Error removing rule ${ruleIdToBypass}:`, error);
                }
            }

            // Step 2: Reset the timer for this URL.
            const storageKey = 'last_visit_timestamp_' + encodeURIComponent(originalUrl);
            await chrome.storage.local.set({ [storageKey]: Date.now() });
            console.log(`[Background] Timer reset (last visit set to now) for ${originalUrl} due to 'Let me in'.`);

            // Step 3: Set a temporary allowance for the tab to prevent re-blocking on immediate reload.
            // This allowance is checked and consumed by the onUpdated listener.
            const allowanceDurationMs = 2 * 1000; // 2 seconds should be enough for navigation
            temporaryAllowAccess[tabId] = { url: originalUrl, expires: Date.now() + allowanceDurationMs };
            console.log(`[Background] Temporary allowance granted for tab ${tabId} for URL: ${originalUrl}, expires in ${allowanceDurationMs / 1000}s.`);


            // Step 4: Navigate the tab back to the original URL.
            chrome.tabs.update(tabId, { url: originalUrl });

            // No need to call checkAllVisitTimesAndManageRules immediately after tabs.update,
            // as the onUpdated listener will handle re-evaluating rules *after* the page loads.
        }
    }
});

loadTrackedPages();