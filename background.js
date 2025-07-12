// Removed VISIT_LIMIT as it's no longer a count, but a time threshold
const BLOCK_RULE_ID_OFFSET = 1000;

let temporaryAllowAccess = {};

// Changed default property name and value
const DEFAULT_TRACKED_PAGES = [{ url: 'https://www.bbc.com/', minutesSinceLastVisit: 5 }];
let currentTrackedPages = [];

async function loadTrackedPages() {
    const items = await chrome.storage.sync.get({ trackedPages: DEFAULT_TRACKED_PAGES });
    currentTrackedPages = items.trackedPages;
    console.log(`[Background] Tracking these URLs with time limits:`, currentTrackedPages);
    await checkAllVisitTimesAndManageRules(); // Renamed function
}

async function updateRedirectionRulesForAll() {
    const rulesToAdd = [];
    const ruleIdsToRemove = [];

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    existingRules.forEach(rule => {
        if (rule.id >= BLOCK_RULE_ID_OFFSET) {
            ruleIdsToRemove.push(rule.id);
        }
    });

    for (let i = 0; i < currentTrackedPages.length; i++) {
        const page = currentTrackedPages[i];
        const ruleId = BLOCK_RULE_ID_OFFSET + i;

        // Storage key now stores a single lastVisitTimestamp
        const storageKey = 'last_visit_timestamp_' + encodeURIComponent(page.url);
        const result = await chrome.storage.local.get(storageKey);
        const lastVisitTimestamp = result[storageKey] || 0; // 0 if never visited

        const now = Date.now();
        const minutesThresholdMs = /*page.minutesSinceLastVisit*/ 1 * 60 * 1000; // Convert minutes to milliseconds

        // Check if the time since last visit is LESS than the required threshold
        const timeElapsedSinceLastVisit = now - lastVisitTimestamp;
        const shouldBlock = (lastVisitTimestamp !== 0 && timeElapsedSinceLastVisit < minutesThresholdMs);

        console.log(`[Background] URL: ${page.url}, Last Visit: ${lastVisitTimestamp > 0 ? new Date(lastVisitTimestamp).toLocaleTimeString() : 'Never'}, Time Elapsed: ${Math.round(timeElapsedSinceLastVisit / 1000)}s, Required: ${minutesThresholdMs / 1000}s`);

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
            removeRuleIds: ruleIdsToRemove,
            addRules: rulesToAdd
        });
        console.log(`[Background] Dynamic rules updated successfully.`);
    } catch (error) {
        console.error("[Background] Error updating declarativeNetRequest rules:", error);
    }
}

// Renamed function
async function checkAllVisitTimesAndManageRules() {
    await updateRedirectionRulesForAll();
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        let matchedPage = null;

        for (const page of currentTrackedPages) {
            if (tab.url.startsWith(page.url)) {
                matchedPage = page;
                break;
            }
        }

        if (matchedPage) {
            // Check if this specific tab is temporarily allowed for this specific URL
            if (temporaryAllowAccess[tabId] === matchedPage.url) {
                console.log(`[Background] Tab ${tabId} has temporary allowance for ${matchedPage.url}. Skipping setting new visit time.`);
                delete temporaryAllowAccess[tabId];
                return; // Do not update last visit time if it was temporarily allowed
            }

            // Only update last visit time if it's not a temporary allowance
            const storageKey = 'last_visit_timestamp_' + encodeURIComponent(matchedPage.url);
            await chrome.storage.local.set({ [storageKey]: Date.now() }); // Update the last visit timestamp
            console.log(`[Background] Last visit timestamp updated for ${matchedPage.url}.`);

            await checkAllVisitTimesAndManageRules(); // Re-evaluate all rules
        } else {
            await updateRedirectionRulesForAll();
        }
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    await loadTrackedPages();
    // Clear old visit count timestamps (now using single last visit timestamp)
    const allStorage = await chrome.storage.local.get(null);
    for (const key in allStorage) {
        if (key.startsWith('visit_timestamps_') || key.startsWith('last_visit_timestamp_')) { // Clear both old and new keys
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

            // Mark this specific tab as temporarily allowed for this specific URL
            temporaryAllowAccess[tabId] = originalUrl;
            console.log(`[Background] Temporary allowance granted for tab ${tabId} for URL: ${originalUrl}`);

            // Reset the timer: Set the last visit timestamp for this URL to NOW
            // This makes the current time count as the "last visit" effectively resetting the cooldown.
            const storageKey = 'last_visit_timestamp_' + encodeURIComponent(originalUrl);
            await chrome.storage.local.set({ [storageKey]: Date.now() });
            console.log(`[Background] Timer reset (last visit set to now) for ${originalUrl} due to 'Let me in'.`);


            await updateRedirectionRulesForAll(); // Re-evaluate rules (should now unblock originalUrl)

            chrome.tabs.update(tabId, { url: originalUrl }, () => {
                 setTimeout(async () => {
                     await checkAllVisitTimesAndManageRules(); // Re-evaluate all rules after short delay
                 }, 1000);
            });
        }
    }
});

loadTrackedPages();