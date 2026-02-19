/* 
================================================================
PART 1: CORE ENGINE
Constants, Formatting, and calculation logic.
================================================================
*/
const CapTableRowType = {
    Common: "common",
    Safe: "safe",
    Series: "series",
    Total: "total",
    RefreshedOptions: "refreshedOptions",
};

const CommonRowType = {
    Shareholder: "shareholder",
    UnusedOptions: "unusedOptions",
};

const DEFAULT_ROUNDING_STRATEGY = {
    roundShares: true,
    roundPPSPlaces: 8,
};

const stringToNumber = (value) => {
    
    if (typeof value === "number") return value;

    const cleanedValue = String(value).replace(/[^-\d.]/g, "");

    return cleanedValue.includes(".")
        ? parseFloat(cleanedValue)
        : parseInt(cleanedValue, 10) || 0;
};

const formatUSDWithCommas = (value) => {
    const num = stringToNumber(value);
    return num.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0, 
    });
};

const formatNumberWithCommas = (value) => {
    return stringToNumber(value).toLocaleString("en-US", { style: "decimal" });
};

const safeFormatPercent = (value, decimals = 2) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    const formatted = (value * 100).toFixed(decimals);
    if (parseFloat(formatted) === 0) return "—";
    return `${formatted}%`;
};

const safeFormatNumber = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatNumberWithCommas(value);
};

const safeFormatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatUSDWithCommas(value);
};

const formatPPSWithCommas = (value) => {
    const num = stringToNumber(value);
    return num.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 3,  
        minimumFractionDigits: 2,  
    });
};

const safeFormatPPS = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value) || value === 0)
        return "—";
    return formatPPSWithCommas(value);
};

const formatInputLive = (input) => {
    let value = input.value;
    const start = input.selectionStart;
    const oldLength = value.length;

    let digits = value.replace(/\D/g, "");
    input.value = digits === "" ? "0" : formatNumberWithCommas(parseInt(digits));

    const newLength = input.value.length;
    const diff = newLength - oldLength;
    const newPos = Math.max(0, start + diff);
    input.setSelectionRange(newPos, newPos);
};

window.formatInputLive = formatInputLive;

const formatDiscountLive = (input) => {
    let value = input.value;
    // Remove non-digits
    let digits = value.replace(/\D/g, "");
    
    // Limit to 2 digits total
    if (digits.length > 2) {
        digits = digits.slice(0, 2);
    }
    
    // Check for max value 99
    let num = parseInt(digits) || 0;
    if (num > 99) {
        num = 99;
        digits = "99";
    }
    
    // Update input (allow empty if user cleared it)
    input.value = digits === "" ? "" : num.toString();
};

window.formatDiscountLive = formatDiscountLive;

const roundShares = (num, strategy = DEFAULT_ROUNDING_STRATEGY) => {
    if (strategy.roundDownShares) return Math.floor(num);
    if (strategy.roundShares) return Math.round(num);
    return num;
};

const roundPPSToPlaces = (num, places) => {
    if (places < 0) return num;
    const factor = Math.pow(10, places);
    return Math.ceil(num * factor) / factor;
};

/**
 * Checks if a SAFE note is a "Most Favored Nation" (MFN) note.
 * MFN SAFEs don't have their own cap but adopt the best cap (lowest) 
 * from other SAFEs in the same round.
 */
const isMFN = (safe) => {
    return (
        safe.conversionType === "mfn" ||
        safe.conversionType === "ycmfn" ||
        (safe.sideLetters && safe.sideLetters.includes("mfn"))
    );
};

const getMFNCapAfter = (rows, idx) => {
    return (
        rows.slice(idx + 1).reduce((val, row) => {
            if (isMFN(row) || row.conversionType === "pre") return val;
            if (val === 0) return row.cap;
            if (val > 0 && row.cap > 0 && row.cap < val) return row.cap;
            return val;
        }, 0) || 0
    );
};

const getCapForSafe = (idx, safes, preMoneyValuation = 0) => {
    const safe = safes[idx];
    if (!isMFN(safe)) return safe.cap;
    const inheritedCap = getMFNCapAfter(safes, idx);
    const ownCap = safe.cap || 0;
    
    let baseCap = 0;
    if (ownCap > 0 && inheritedCap > 0) baseCap = Math.min(ownCap, inheritedCap);
    else if (ownCap > 0) baseCap = ownCap;
    else if (inheritedCap > 0) baseCap = inheritedCap;
    else baseCap = preMoneyValuation;

    if (baseCap > 0 && isMFN(safe) && safe.discount > 0 && inheritedCap === 0 && ownCap === 0) {
        return baseCap * (1 - safe.discount);
    }
    
    return baseCap;
};

/**
 * Resolves Valuation Caps for all SAFEs, including MFNs.
 * Iterates through notes to ensure MFN notes adopt the lowest cap found in the list.
 */
const populateSafeCaps = (safeNotes, preMoneyValuation = 0) => {
    return safeNotes.map((safe, idx) => {
        if (isMFN(safe)) {
            return { ...safe, cap: getCapForSafe(idx, safeNotes, preMoneyValuation) };
        }
        return { ...safe };
    });
};

const safeConvert = (safe, preShares, postShares, pps) => {
    if (safe.cap === 0) return (1 - (safe.discount || 0)) * pps;
    const discountPPS = (1 - (safe.discount || 0)) * pps;
    const shares = safe.conversionType === "pre" ? preShares : postShares;
    const capPPS = safe.cap / shares;
    return Math.min(discountPPS, capPPS);
};

const sumSafeConvertedShares = (safes, pps, preMoneyShares, postMoneyShares, roundingStrategy) => {
    return safes.reduce((acc, safe) => {
        const discountPPS = roundPPSToPlaces(
            safeConvert(safe, preMoneyShares, postMoneyShares, pps),
            roundingStrategy.roundPPSPlaces
        );
        const postSafeShares = safe.investment / discountPPS;
        return acc + roundShares(postSafeShares, roundingStrategy);
    }, 0);
};

const checkSafeNotesForErrors = (safeNotes) => {
    const errors = {};
    safeNotes.forEach((safe) => {
        if (safe.investment >= safe.cap && safe.cap !== 0) {
            errors[safe.id] = "SAFE investment cannot be greater than or equal to the valuation cap.";
        }
        if (safe.discount >= 1) {
            errors[safe.id] = `SAFE "${safe.name}" has a discount of 100% or more. This results in a zero share price, which is mathematically invalid for the calculation.`;
        }
    });
    return errors;
};

/**
 * Core algebraic solver for the Price Per Share (PPS).
 * Uses the formula: PPS = (Pre-Money + New Investment) / (Total Post-Money Shares)
 * This function accounts for dilution from SAFEs and Option pool top-ups.
 */
const calculatePreAndPostMoneyShares = (
    preMoneyValuation,
    commonShares,
    unusedOptions,
    targetOptionsPct,
    seriesInvestments,
    totalShares,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {
    let optionsPool = roundShares(totalShares * (targetOptionsPct / 100), roundingStrategy);
    if (optionsPool < unusedOptions) optionsPool = unusedOptions;
    const increaseInOptionsPool = optionsPool - unusedOptions;
    const seriesInvestmentTotal = seriesInvestments.reduce((a, b) => a + b, 0);
    const pps = totalShares > 0
        ? roundPPSToPlaces((preMoneyValuation + seriesInvestmentTotal) / totalShares, roundingStrategy.roundPPSPlaces)
        : 0;
    const seriesShares = pps > 0
        ? seriesInvestments.reduce((acc, inv) => acc + roundShares(inv / pps, roundingStrategy), 0)
        : 0;
    const preMoneyShares = commonShares + unusedOptions + increaseInOptionsPool;
    const postMoneyShares = totalShares - seriesShares - increaseInOptionsPool;

    return {
        preMoneyShares,
        postMoneyShares,
        pps,
        optionsPool,
        increaseInOptionsPool,
        totalShares: postMoneyShares + increaseInOptionsPool + seriesShares,
        seriesShares,
        totalSeriesInvestment: seriesInvestmentTotal,
    };
};

const attemptFit = (preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, safes, seriesInvestments, totalShares, roundingStrategy = DEFAULT_ROUNDING_STRATEGY) => {
    const results = calculatePreAndPostMoneyShares(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, seriesInvestments, totalShares, roundingStrategy);
    const safeShares = sumSafeConvertedShares(safes, results.pps, results.preMoneyShares, results.postMoneyShares, roundingStrategy);
    return results.seriesShares + commonShares + results.optionsPool + safeShares;
};

/**
 * Iterative "FIT" solver to handle circular dependencies.
 * In many startup rounds, the Option pool size depends on the Post-Money Valuation,
 * which in turn depends on the Price Per Share, which depends on the Option pool size.
 * This function runs multiple iterations to converge on the mathematically correct PPS.
 */
const fitConversion = (
    preMoneyValuation,
    commonShares,
    safes,
    unusedOptions,
    targetOptionsPct,
    seriesInvestments,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {
    let totalShares = commonShares + unusedOptions;
    let lastTotalShares = totalShares;
    for (let i = 0; i < 100; i++) {
        totalShares = attemptFit(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, safes, seriesInvestments, totalShares, roundingStrategy);
        if (totalShares === lastTotalShares) break;
        lastTotalShares = totalShares;
    }
    const res = calculatePreAndPostMoneyShares(preMoneyValuation, commonShares, unusedOptions, targetOptionsPct, seriesInvestments, totalShares, roundingStrategy);
    const ppss = safes.map((safe) =>
        roundPPSToPlaces(safeConvert(safe, res.preMoneyShares, res.postMoneyShares, res.pps), roundingStrategy.roundPPSPlaces)
    );
    const convertedSafeShares = sumSafeConvertedShares(safes, res.pps, res.preMoneyShares, res.postMoneyShares, roundingStrategy);
    const totalSeriesInvestment = seriesInvestments.reduce((a, b) => a + b, 0);

    return {
        ...res,
        ppss,
        totalShares,
        newSharesIssued: totalShares - commonShares - unusedOptions,
        convertedSafeShares,
        totalOptions: res.increaseInOptionsPool + unusedOptions,
        additionalOptions: res.increaseInOptionsPool,
        totalInvested: totalSeriesInvestment + safes.reduce((acc, safe) => acc + safe.investment, 0),
        totalSeriesInvestment,
    };
};

const buildTBDPreRoundCapTable = (safeNotes, common) => {
    const totalInvestment = safeNotes.reduce((acc, investor) => acc + investor.investment, 0);
    const totalShares = common.reduce((acc, c) => acc + c.shares, 0);
    const reason = "Unable to model Pre-Round cap table with uncapped SAFE's";
    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: 0,
            ownershipError: { type: "tbd", reason },
        })),
        safes: safeNotes.map((s) => ({
            ...s,
            ownershipError: { type: "tbd", reason },
            type: CapTableRowType.Safe,
        })),
        total: {
            name: "Total",
            shares: totalShares,
            investment: totalInvestment,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildErrorPreRoundCapTable = (safeNotes, common) => {
    const totalInvestment = safeNotes.reduce((acc, investor) => acc + investor.investment, 0);
    const totalShares = common.reduce((acc, c) => acc + c.shares, 0);
    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: 0,
            ownershipError: { type: "error" },
        })),
        safes: safeNotes.map((s) => {
            const error = { type: "error" };
            if (s.investment >= s.cap && s.cap !== 0) error.reason = "SAFE investment cannot equal or exceed the valuation cap";
            return { ...s, ownershipError: error, type: CapTableRowType.Safe };
        }),
        total: {
            name: "Total",
            shares: totalShares,
            investment: totalInvestment,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildStrictlyPreRoundCapTable = (rowData) => {
    const common = rowData.filter((r) => r.type === CapTableRowType.Common);
    const totalShares = common.reduce((acc, r) => acc + r.shares, 0);

    return {
        common: common.map((c) => ({
            ...c,
            ownershipPct: totalShares > 0 ? c.shares / totalShares : 0,
        })),
        safes: rowData
            .filter((r) => r.type === CapTableRowType.Safe)
            .map((s) => ({ ...s, shares: 0, ownershipPct: 0 })),
        total: {
            shares: totalShares,
            investment: 0,
            ownershipPct: 1,
            type: CapTableRowType.Total,
        },
    };
};

const buildEstimatedPreRoundCapTable = (
    rowData,
    roundingStrategy = DEFAULT_ROUNDING_STRATEGY
) => {

    const common = rowData.filter((r) => r.type === CapTableRowType.Common);
    const preMoneyShares = common.reduce((acc, r) => acc + r.shares, 0);
    const safeNotes = populateSafeCaps(
        rowData.filter((r) => r.type === CapTableRowType.Safe)
    );

    if (safeNotes.length === 0) {
        return buildStrictlyPreRoundCapTable(rowData);
    }

    if (safeNotes.some((s) => s.cap !== 0 && s.cap <= s.investment)) {

        return buildErrorPreRoundCapTable(safeNotes, common);

    }

    const maxCap = safeNotes.reduce((max, s) => Math.max(max, s.cap), 0);

    if (maxCap === 0) return buildTBDPreRoundCapTable(safeNotes, common);

    let safeRows = safeNotes.map((safe) => {

        const cap = safe.cap === 0 ? maxCap : safe.cap;

        if (safe.conversionType === "pre") {

            const shares = roundShares(

                (safe.investment / cap) * preMoneyShares,

                roundingStrategy

            );

            return { ...safe, shares, type: CapTableRowType.Safe };

        } else {

            return {

                ...safe,

                ownershipPct: safe.investment / cap,

                type: CapTableRowType.Safe,

            };

        }

    });

    const preMoneySafeShares = safeRows.reduce(

        (acc, s) => acc + (s.shares || 0),

        0

    );

    const postSharePct = safeRows.reduce(

        (acc, s) => acc + (s.ownershipPct || 0),

        0

    );

    const postCap = roundShares(

        (preMoneyShares + preMoneySafeShares) / (1 - postSharePct),

        roundingStrategy

    );

    safeRows = safeRows.map((s) => {

        if (s.shares) return { ...s, ownershipPct: s.shares / postCap };

        return {

            ...s,

            shares: roundShares((s.ownershipPct || 0) * postCap, roundingStrategy),

        };

    });

    const finalTotalShares =

        preMoneyShares + safeRows.reduce((acc, s) => acc + (s.shares || 0), 0);

    return {

        common: common.map((c) => ({ ...c, ownershipPct: c.shares / postCap })),

        safes: safeRows,

        total: {

            shares: finalTotalShares,

            investment: safeNotes.reduce((a, s) => a + s.investment, 0),

            ownershipPct: 1,

            type: CapTableRowType.Total,

        },

    };

};

/**
 * Maps the solved priced round data back into a readable Cap Table format.
 * Calculates final share counts for Founders, SAFEs, and New Investors.
 */
const buildPricedRoundCapTable = (pricedConversion, rowData) => {

    const common = rowData.filter(

        (r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool"

    );

    const safes = rowData.filter((r) => r.type === CapTableRowType.Safe);

    const series = rowData.filter((r) => r.type === CapTableRowType.Series);

    const totalShares = pricedConversion.totalShares;

    const totalInvestment =

        series.reduce((a, s) => a + s.investment, 0) +

        safes.reduce((a, s) => a + s.investment, 0);

    return {

        common: common.map((c) => ({ ...c, ownershipPct: c.shares / totalShares })),

        safes: safes.map((s, idx) => {

            const pps = pricedConversion.ppss[idx];

            const shares = roundShares(s.investment / pps);

            return {

                ...s,

                pps,

                shares,

                ownershipPct: shares / totalShares,

                type: CapTableRowType.Safe,
                isMFN: isMFN(s),

            };

        }),

        series: series.map((se) => {

            const shares = roundShares(se.investment / pricedConversion.pps);

            return {

                ...se,

                pps: pricedConversion.pps,

                shares,

                ownershipPct: shares / totalShares,

                type: CapTableRowType.Series,

            };

        }),

        refreshedOptionsPool: {

            name: "Refreshed Options Pool",

            shares: pricedConversion.totalOptions,

            ownershipPct: pricedConversion.totalOptions / totalShares,

            type: CapTableRowType.RefreshedOptions,

        },

        total: {

            name: "Total",

            shares: totalShares,

            investment: totalInvestment,

            ownershipPct: 1,

            type: CapTableRowType.Total,

        },

    };

};

/* 
================================================================
PART 2: UI & RENDERING
State management, updateUI, and chart rendering.
================================================================
*/
const INITIAL_STATE = {
    name: "Standalone Worksheet",
    roundName: "Series A",
    rowData: [
        {
            id: "1",
            type: "common",
            name: "Founder 1",
            shares: 4000000,
            category: "Founder",
        },
        {
            id: "2",
            type: "common",
            name: "Founder 2",
            shares: 4000000,
            category: "Founder",
        },
        {
            id: "UnusedOptionsPool",
            type: "common",
            name: "Option pool",
            shares: 2000000,
            category: "Option pool",
        },
        {
            id: "3",
            type: "safe",
            name: "SAFE 1",
            investment: 500000,
            cap: 1000000,
            discount: 0.2, 
            conversionType: "post",
        },
        { id: "4", type: "series", name: "Investor 1", investment: 2000000 },
    ],
    preMoney: 10000000,
    targetOptionsPool: null,
    pricedRounds: 1, 
};

let state = JSON.parse(JSON.stringify(INITIAL_STATE));

window.resetCalculator = () => {
    state = JSON.parse(JSON.stringify(INITIAL_STATE));
    clearGlobalErrors();
    updateUI();
};

const showGlobalError = (message) => {
    const container = document.getElementById("global-error-container");
    if (container) {
        container.innerHTML = ""; // Clear any previous inline errors
    }
    
    // Show only the toast (popup) as requested
    showToast(message, 'error');
};

const clearGlobalErrors = () => {
    const container = document.getElementById("global-error-container");
    if (container) container.innerHTML = "";
};

const TRASH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`;

const updateUI = () => {
    try {
        clearGlobalErrors();
        
        const preMoneyErrorEl = document.getElementById("pre-money-error");
        const preMoneyInputWrapper = document.querySelector(".valuation-input-wrapper");
        
        if (preMoneyErrorEl) {
            preMoneyErrorEl.textContent = "";
            preMoneyErrorEl.style.display = "none";
        }
        if (preMoneyInputWrapper) preMoneyInputWrapper.classList.remove("input-invalid-border");

        // Contextual Pre-money Validation: only show error if investment exists WITHOUT a cap or discount
        const hasInvestmentWithoutTerms = state.rowData.some(r => {
            if (r.type === CapTableRowType.Safe) {
                return r.investment > 0 && (r.cap === 0 || !r.cap) && (r.discount === 0 || !r.discount);
            }
            return false;
        });

        if (state.preMoney <= 0) {
            if (hasInvestmentWithoutTerms) {
                if (preMoneyErrorEl) {
                    preMoneyErrorEl.textContent = "Pre-money valuation is required and must be greater than 0.";
                    preMoneyErrorEl.style.display = "block";
                }
                if (preMoneyInputWrapper) preMoneyInputWrapper.classList.add("input-invalid-border");
            }
            
            // Still clear results if pre-money is 0, just without the red error message visibility
            document.getElementById("round-pps-val").textContent = "—";
            document.getElementById("post-money-val").textContent = "—";
            document.getElementById("total-post-shares-val").textContent = "—";
            document.getElementById("founder-ownership-val").textContent = "—";
            document.getElementById("founder-dilution-val").textContent = "—";
            document.getElementById("post-round-table").innerHTML = "";
            document.getElementById("pie-chart-container").innerHTML = "";
            document.getElementById("bar-chart-container").innerHTML = "";
            document.getElementById("ai-insights-container").innerHTML = "";
            return;
        }

        // =========================================================================
        // SNAPSHOT 2: PRE-ROUND CAP TABLE (Post-SAFE)
        // =========================================================================
        const preRound = buildEstimatedPreRoundCapTable(state.rowData);

        const preMoneyInput = document.getElementById("pre-money-input");
        if (preMoneyInput && document.activeElement !== preMoneyInput) {
            preMoneyInput.value = formatNumberWithCommas(state.preMoney);
        }

        const targetOptionsInput = document.getElementById("target-options-input");
        if (targetOptionsInput && document.activeElement !== targetOptionsInput) {
            targetOptionsInput.value = state.targetOptionsPool === null ? "" : state.targetOptionsPool;
        }

        const rawSafes = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
        const safes = populateSafeCaps(rawSafes, state.preMoney);
        const safeErrors = checkSafeNotesForErrors(safes);

        renderSAFEs(safeErrors);
        renderSeriesInvestors();

        const esopRow = state.rowData.find((r) => r.id === "UnusedOptionsPool");
        const unusedOptionsValue = esopRow ? esopRow.shares : 0;

        // Current Cap Table Snapshot (for input management)
        const currentTotalShares = state.rowData
            .filter((r) => r.type === CapTableRowType.Common)
            .reduce((a, r) => a + r.shares, 0);

        const totalSharesVal = document.getElementById("total-shares-val");
        if (totalSharesVal) totalSharesVal.textContent = formatNumberWithCommas(currentTotalShares);

        const currentEsopVal = document.getElementById("current-esop-val");
        if (currentEsopVal) currentEsopVal.textContent = formatNumberWithCommas(unusedOptionsValue);

        renderShareholders(currentTotalShares);

        if (Object.keys(safeErrors).length > 0) {
            document.getElementById("round-pps-val").textContent = "—";
            document.getElementById("post-money-val").textContent = "—";
            document.getElementById("total-post-shares-val").textContent = "—";
            document.getElementById("founder-ownership-val").textContent = "—";
            document.getElementById("founder-dilution-val").textContent = "—";
            document.getElementById("post-round-table").innerHTML = "";
            return; 
        }

        const roundNames = document.querySelectorAll(".display-round-name");
        roundNames.forEach(el => {
            el.textContent = state.roundName || "priced round";
        });

        const commonShares = state.rowData
            .filter((r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool")
            .reduce((a, r) => a + r.shares, 0);

        const seriesInvs = state.rowData
            .filter((r) => r.type === CapTableRowType.Series)
            .map((s) => s.investment);

        const pricedConversion = fitConversion(
            state.preMoney,
            commonShares,
            safes,
            unusedOptionsValue,
            state.targetOptionsPool,
            seriesInvs
        );

        const roundPpsEl = document.getElementById("round-pps-val");
        if (roundPpsEl) roundPpsEl.textContent = safeFormatPPS(pricedConversion.pps);

        const postMoneyVal = pricedConversion.totalShares * pricedConversion.pps;
        const postMoneyEl = document.getElementById("post-money-val");
        if (postMoneyEl) postMoneyEl.textContent = safeFormatCurrency(postMoneyVal);
        
        const additionalOptions = pricedConversion.additionalOptions;
        const additionalOptionsEl = document.getElementById("additional-options-val");
        if (additionalOptionsEl) additionalOptionsEl.textContent = safeFormatNumber(additionalOptions);

        const additionalOptionsTextEl = document.getElementById("additional-options-val-text");
        const meetsTargetNoteEl = document.getElementById("option-pool-meets-target-note");
        
        if (additionalOptionsTextEl) {
            // Keep this always visible as requested
            additionalOptionsTextEl.style.display = "block";
            additionalOptionsTextEl.textContent = `+${safeFormatNumber(additionalOptions)} shares will be added to reach the target`;
        }
        
        if (meetsTargetNoteEl) {
            // Show the "already meets" note separately below
            meetsTargetNoteEl.style.display = (additionalOptions <= 0 && state.targetOptionsPool > 0) ? "block" : "none";
        }
        const newInvestorsSharesEl = document.getElementById("new-investors-shares-val");
        if (newInvestorsSharesEl) newInvestorsSharesEl.textContent = safeFormatNumber(pricedConversion.seriesShares);

        // =========================================================================
        // SNAPSHOT 3: POST-ROUND CAP TABLE
        // =========================================================================
        const postRound = buildPricedRoundCapTable(pricedConversion, state.rowData);

        // Synchronize SAFE shares between Pre and Post if a priced round exists.
        // This ensures the "Pre" column shows the actual conversion realized in the round,
        // rather than a standalone estimate.
        preRound.safes = preRound.safes.map(preSafe => {
            const postSafe = postRound.safes.find(ps => ps.id === preSafe.id);
            return postSafe ? { ...preSafe, shares: postSafe.shares } : preSafe;
        });

        // Recalculate pre-round totals and percentages based on synchronized shares
        preRound.total.shares = preRound.common.reduce((a, c) => a + (c.shares || 0), 0) + 
                                preRound.safes.reduce((a, s) => a + (s.shares || 0), 0);
        preRound.common.forEach(c => c.ownershipPct = c.shares / preRound.total.shares);
        preRound.safes.forEach(s => s.ownershipPct = s.shares / preRound.total.shares);

        const totalPostSharesEl = document.getElementById("total-post-shares-val");
        if (totalPostSharesEl) totalPostSharesEl.textContent = safeFormatNumber(postRound.total.shares);

        const foundersPost = postRound.common.filter((c) => c.category === "Founder");
        const totalFounderPctPost = foundersPost.reduce((a, f) => a + f.ownershipPct, 0);

        // All "Pre" calculations happen 'Post-SAFE Pre-Round'
        const commonSharesTotalPre = preRound.total.shares;
        const founderSharesPre = preRound.common
            .filter((c) => c.category === "Founder")
            .reduce((a, c) => a + c.shares, 0);

        const totalFounderPctPre = commonSharesTotalPre > 0 ? founderSharesPre / commonSharesTotalPre : 0;

        const founderOwnershipEl = document.getElementById("founder-ownership-val");
        if (founderOwnershipEl) founderOwnershipEl.textContent = safeFormatPercent(totalFounderPctPost);

        const dilution = totalFounderPctPre > 0 ? totalFounderPctPre - totalFounderPctPost : NaN;
        const founderDilutionEl = document.getElementById("founder-dilution-val");
        if (founderDilutionEl) founderDilutionEl.textContent = safeFormatPercent(dilution);

        const dilutionNoteEl = document.getElementById("dilution-summary-note");
        if (dilutionNoteEl) {
            const dilutionVal = isNaN(dilution) ? "—" : (dilution * 100).toFixed(2);
            dilutionNoteEl.textContent = `Founders diluted by ${dilutionVal} percentage points.`;
        }

        // Pass Pre-Round (Post-SAFE) and Post-Round to the breakdown table.
        renderBreakdownTable(preRound, postRound, pricedConversion.pps);
        renderPieChart(postRound);
        renderBarChart(totalFounderPctPre, totalFounderPctPost);
        renderAIAdvisor(preRound, postRound, pricedConversion, state, totalFounderPctPre);

    } catch (error) {
        console.error("Error updating UI:", error);
    }
};

const renderShareholders = (totalSharesS0) => {
    const container = document.getElementById("shareholders-body");
    container.innerHTML = "";
    const shareholders = state.rowData.filter((r) => r.type === CapTableRowType.Common);
    const showDelete = shareholders.length > 1;
    const template = document.getElementById("shareholder-card-template");
    
    shareholders.forEach((row) => {
        const ownershipPct = totalSharesS0 > 0 ? row.shares / totalSharesS0 : NaN;
        const pctText = safeFormatPercent(ownershipPct);
        const clone = template.content.cloneNode(true);
        
        const nameInput = clone.querySelector(".row-name");
        nameInput.value = row.name;
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);
        
        const deleteBtn = clone.querySelector(".row-trash-btn");
        if (showDelete) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        
        const categorySelect = clone.querySelector(".row-category");
        categorySelect.value = row.category;
        categorySelect.onchange = (e) => updateRow(row.id, 'category', e.target.value);
        
        const sharesInput = clone.querySelector(".row-shares");
        sharesInput.value = formatNumberWithCommas(row.shares);
        sharesInput.oninput = (e) => formatInputLive(e.target);
        sharesInput.onchange = (e) => updateRow(row.id, 'shares', e.target.value);
        
        clone.querySelector(".row-pct").textContent = pctText;
        container.appendChild(clone);
    });

    const footer = document.getElementById("cap-table-footer");
    footer.className = "card-footer-total";
    footer.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total fully diluted shares</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatNumberWithCommas(totalSharesS0)}</span>
    `;
};

const renderSAFEs = (errors = {}) => {
    const container = document.getElementById("safes-body");
    if (!container) return;
    container.innerHTML = "";
    const safeRows = state.rowData.filter((r) => r.type === CapTableRowType.Safe);
    const showDelete = safeRows.length > 1;
    const template = document.getElementById("safe-card-template");
    let totalInv = 0;
    
    safeRows.forEach((row, idx) => {
        totalInv += row.investment;
        const isMfnRow = isMFN(row);
        const effectiveCap = getCapForSafe(idx, safeRows);
        const displayCap = isMfnRow ? effectiveCap : row.cap;
        
        const clone = template.content.cloneNode(true);
        const nameInput = clone.querySelector(".safe-name-input");
        nameInput.value = row.name;
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);
        
        const deleteBtn = clone.querySelector(".row-trash-btn");
        if (showDelete) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        
        const invInput = clone.querySelector(".safe-investment");
        invInput.value = formatNumberWithCommas(row.investment);
        invInput.oninput = (e) => formatInputLive(e.target);
        invInput.onchange = (e) => updateRow(row.id, 'investment', e.target.value);
        
        const capInput = clone.querySelector(".safe-cap");
        capInput.value = formatNumberWithCommas(displayCap);
        if (isMfnRow) capInput.readOnly = true;
        capInput.oninput = (e) => formatInputLive(e.target);
        capInput.onchange = (e) => updateRow(row.id, 'cap', e.target.value);
        
        const discountInput = clone.querySelector(".safe-discount-input");
        discountInput.value = row.discount === 0 ? "" : Math.round(row.discount * 100);
        discountInput.oninput = (e) => formatDiscountLive(e.target);
        discountInput.onchange = (e) => updateRow(row.id, 'discount', e.target.value);
        
        const typeSelect = clone.querySelector(".safe-type");
        typeSelect.value = row.conversionType;
        typeSelect.onchange = (e) => updateRow(row.id, 'conversionType', e.target.value);
        
        const calcBtn = clone.querySelector(".btn-calc");
        if (calcBtn) {
            calcBtn.dataset.id = row.id;
            calcBtn.onclick = (e) => window.calculateSafeDiscount_UI(e.target);
        }
        
        // Show/hide notes based on SAFE type and configuration
        const noteElement = clone.querySelector(".safe-conversion-note");
        const mfnNoteElement = clone.querySelector(".safe-mfn-note");
        const mfnDiscountNoteElement = clone.querySelector(".safe-mfn-discount-note");
        
        const isMfnType = row.conversionType === 'mfn';
        const hasNoCap = (!row.cap || row.cap === 0) && (!row.discount || row.discount === 0);
        const hasDiscount = row.discount > 0;
        
        if (isMfnType) {
            // MFN SAFE
            if (noteElement) noteElement.style.display = "none";
            
            if (effectiveCap === 0) {
                if (hasDiscount) {
                    // MFN with discount and no inherited cap
                    if (mfnNoteElement) mfnNoteElement.style.display = "none";
                    if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "block";
                } else {
                    // MFN with NO discount and no inherited cap
                    if (mfnNoteElement) mfnNoteElement.style.display = "block";
                    if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
                }
            } else {
                // MFN that inherited a cap
                if (mfnNoteElement) mfnNoteElement.style.display = "none";
                if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
            }
        } else {
            // Pre-money or Post-money SAFE: show conversion note if no cap/discount
            if (noteElement) noteElement.style.display = hasNoCap ? "block" : "none";
            if (mfnNoteElement) mfnNoteElement.style.display = "none";
            if (mfnDiscountNoteElement) mfnDiscountNoteElement.style.display = "none";
        }
        
        // Inline validation error for SAFEs
        const safeErrorEl = clone.querySelector(".safe-error-msg");
        if (safeErrorEl && errors[row.id]) {
            safeErrorEl.textContent = errors[row.id];
            safeErrorEl.style.display = "block";
            // Highlight relevant inputs
            invInput.classList.add("input-invalid-border");
            capInput.classList.add("input-invalid-border");
        }
        
        container.appendChild(clone);
    });

    const safesSection = document.getElementById("safes-container").parentElement;
    let totalRow = safesSection.querySelector(".card-footer-total");
    if (!totalRow) {
        totalRow = document.createElement("div");
        totalRow.className = "card-footer-total";
        safesSection.appendChild(totalRow);
    }
    
    totalRow.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total SAFE investment</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatUSDWithCommas(totalInv)}</span>
    `;
};

const renderSeriesInvestors = () => {
    const container = document.getElementById("series-body");
    if (!container) return;
    container.innerHTML = "";
    const seriesInvestors = state.rowData.filter((r) => r.type === CapTableRowType.Series);
    const showDelete = seriesInvestors.length > 1;
    const template = document.getElementById("series-investor-template");
    let totalInv = 0;
    
    seriesInvestors.forEach((row) => {
        totalInv += row.investment;
        const clone = template.content.cloneNode(true);
        
        const nameInput = clone.querySelector(".investor-name");
        nameInput.value = row.name;
        nameInput.onchange = (e) => updateRow(row.id, 'name', e.target.value);
        
        const invInput = clone.querySelector(".series-investor-input");
        invInput.value = formatNumberWithCommas(row.investment);
        invInput.oninput = (e) => formatInputLive(e.target);
        invInput.onchange = (e) => updateRow(row.id, 'investment', e.target.value);
        
        const deleteBtn = clone.querySelector(".row-trash-btn");
        if (showDelete) {
            deleteBtn.innerHTML = TRASH_ICON;
            deleteBtn.onclick = () => deleteRow(row.id);
        } else {
            deleteBtn.remove();
        }
        
        container.appendChild(clone);
    });

    const seriesSection = document.getElementById("series-container").parentElement;
    let totalRow = seriesSection.querySelector(".card-footer-total-series");
    if (!totalRow) {
        totalRow = document.createElement("div");
        totalRow.className = "card-footer-total card-footer-total-series";
        seriesSection.appendChild(totalRow);
    }
    totalRow.innerHTML = `
        <span style="font-family: 'Inter', sans-serif; font-size: 14px; color: #444266;">Total raised</span>
        <span class="footer-total-value" style="font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #0d0a40;">${formatUSDWithCommas(totalInv)}</span>
    `;
};

const getRowData = (data) => {
    const rows = [];
    if (!data) return rows;

    if (data.common) {
        data.common.forEach((r) => {
            rows.push({
                id: r.id,
                name: r.name,
                category: r.category || "Other",
                shares: r.shares || 0,
                ownershipPct: r.ownershipPct || 0,
                isPricedOrSafe: false,
            });
        });
    }

    if (data.safes) {
        data.safes.forEach((s) => {
            rows.push({
                id: s.id,
                name: s.name,
                category: "Investor", // Branding for SAFEs in the table
                shares: s.shares || 0,
                ownershipPct: s.ownershipPct || 0,
                isPricedOrSafe: true,
                pps_val: s.pps,
                conversionType: s.conversionType,
                isMFN: isMFN(s),
            });
        });
    }

    if (data.series) {
        data.series.forEach((se) => {
            rows.push({
                id: se.id,
                name: se.name || "New Investor",
                category: "Investor",
                shares: se.shares || 0,
                ownershipPct: se.ownershipPct || 0,
                isPricedOrSafe: true,
                pps_val: se.pps,
            });
        });
    }

    if (data.refreshedOptionsPool && data.refreshedOptionsPool.shares > 0) {
        rows.push({
            id: "UnusedOptionsPool",
            name: "Option pool",
            category: "Option pool",
            shares: data.refreshedOptionsPool.shares || 0,
            ownershipPct: data.refreshedOptionsPool.ownershipPct || 0,
            isPricedOrSafe: false,
        });
    }

    return rows;
};

const renderBreakdownTable = (preData, postData, pps) => {
    const container = document.getElementById("post-round-table");
    if (!container) return;
    container.innerHTML = "";
    const template = document.getElementById("breakdown-row-template");

    const preRows = getRowData(preData);
    const postRows = getRowData(postData);
    const preSharesValid = preData?.total?.shares > 0;
    const postSharesValid = postData?.total?.shares > 0;

    const allIds = Array.from(new Set([...preRows.map((r) => r.id), ...postRows.map((r) => r.id)]));

    allIds.forEach((id) => {
        const pre = preRows.find((r) => r.id === id) || { shares: 0, ownershipPct: 0, isVirtual: true };
        const post = postRows.find((r) => r.id === id) || { shares: 0, ownershipPct: 0 };

        const prePctLabel = preSharesValid && !pre.isVirtual && pre.shares > 0 ? safeFormatPercent(pre.ownershipPct) : "—";
        const postPctLabel = postSharesValid && post.shares > 0 ? safeFormatPercent(post.ownershipPct) : "—";

        const clone = template.content.cloneNode(true);
        const tr = clone.querySelector("tr");
        tr.id = `row-${id}`;
        
        clone.querySelector(".row-display-name").textContent = post.name || pre.name || "—";
        
        let tagsHtml = "";
        if (post.isPricedOrSafe && post.category === "Investor") {
            const safeMatch = postData.safes?.find(s => s.id === id);
            if (safeMatch) {
                if (safeMatch.isMFN) tagsHtml += `<span class="tag tag-mfn" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-family: 'Inter', sans-serif;">MFN SAFE</span>`;
                else if (safeMatch.conversionType === "pre") tagsHtml += `<span class="tag tag-pre" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-family: 'Inter', sans-serif;">Pre-money SAFE</span>`;
                else tagsHtml += `<span class="tag tag-post" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-family: 'Inter', sans-serif;">Post-money SAFE</span>`;
            }
        }
        if (post.id === "UnusedOptionsPool" && postSharesValid && pre.shares >= 0 && post.shares > pre.shares + 1) {
            tagsHtml += `<span class="tag tag-topup" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #fef2f2; color: #dc2626; font-family: 'Inter', sans-serif;">Pool top-up</span>`;
        }
        clone.querySelector(".row-tags").innerHTML = tagsHtml;

        clone.querySelector(".row-pre-shares").textContent = safeFormatNumber(pre.shares);
        clone.querySelector(".row-post-shares").textContent = safeFormatNumber(post.shares);
        clone.querySelector(".row-pre-pct").textContent = prePctLabel;
        clone.querySelector(".row-post-pct").textContent = postPctLabel;
        const ppsLabel = post.shares > 0 ? safeFormatPPS(post.pps_val) : "—";
        clone.querySelector(".row-pps").textContent = ppsLabel;

        container.appendChild(clone);
    });

    const totalTr = document.createElement("tr");
    totalTr.className = "total-row"; 
    totalTr.style.fontWeight = "500";
    totalTr.style.backgroundColor = "var(--slate-50)";

    totalTr.innerHTML = `
        <td class="col-name">Total</td>
        <td class="text-right pre-value col-shares-pre">${safeFormatNumber(preData.total.shares)}</td>
        <td class="text-right post-value post-shares-value col-shares-post">${safeFormatNumber(postData.total.shares)}</td>
        <td class="text-right pre-value col-pct-pre">${preSharesValid && preData.total.shares > 0 ? "100.00%" : "—"}</td>
        <td class="text-right post-value post-pct-value col-pct-post">${postSharesValid && postData.total.shares > 0 ? "100.00%" : "—"}</td>
        <td class="text-right col-pps"></td>
    `;
    container.appendChild(totalTr);
};

const renderPieChart = (postRound) => {
    const container = document.getElementById("pie-chart-container");
    if (!container) return;

    if (window.pieChartInstance) {
        window.pieChartInstance.destroy();
        window.pieChartInstance = null;
    }

    container.innerHTML = `
        <div class="chart-wrapper-pie">
            <div class="pie-canvas-box">
                <canvas id="pieChartCanvas"></canvas>
            </div>
            <div id="pieChartLegend" class="chart-legend-grid"></div>
        </div>
    `;

    const totalShares = postRound?.total?.shares || 0;
    if (totalShares <= 0) return;

    const rowData = getRowData(postRound);
    if (!rowData.length) return;

    const labels = rowData.map(r => r.name);
    const data = rowData.map(r => r.shares);
    const categoryPalettes = {
        "Founder": ["#5F17EA", "#7C3AED", "#9333EA", "#A855F7", "#C084FC", "#D8B4FE"],
        "Investor": ["#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#2563EB", "#1D4ED8"],
        "Option pool": ["#FACC15", "#FDE047", "#FEF08A"],
        "Other": ["#64748B", "#94A3B8", "#CBD5E1"]
    };

    const categoryCounters = {};
    const backgroundColors = rowData.map(r => {
        const cat = r.category || "Other";
        if (!categoryCounters[cat]) categoryCounters[cat] = 0;
        const palette = categoryPalettes[cat] || categoryPalettes["Other"];
        const color = palette[categoryCounters[cat] % palette.length];
        categoryCounters[cat]++;
        return color;
    });

    const legendContainer = document.getElementById("pieChartLegend");
    if (legendContainer) {
        legendContainer.innerHTML = rowData.map((r, i) => {
            const percentage = ((r.shares / totalShares) * 100).toFixed(1);
            return `
                <div class="custom-legend-row" onclick="window.scrollToRow('${r.id}')" style="cursor: pointer;">
                    <div class="legend-dot" style="background-color: ${backgroundColors[i]}"></div>
                    <span class="legend-name">${r.name}</span>
                    <span class="legend-pct">${percentage}%</span>
                </div>
            `;
        }).join("");
    }

    const canvas = document.getElementById("pieChartCanvas");
    const ctx = canvas.getContext("2d");

    window.pieChartInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: backgroundColors,
                borderWidth: 0,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "60%",
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const id = rowData[index].id;
                    window.scrollToRow(id);
                }
            },
            onHover: (event, elements) => {
                if (event.native) {
                    event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: '#ffffff',
                    titleColor: '#111827',
                    bodyColor: '#4B5563',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { size: 13, weight: '500', family: "'Inter', sans-serif" },
                    bodyFont: { size: 12, family: "'Inter', sans-serif" },
                    callbacks: {
                        label: (context) => {
                            const value = context.raw;
                            const percentage = ((value / totalShares) * 100).toFixed(1);
                            return ` Shares: ${formatNumberWithCommas(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
};

window.scrollToRow = (id) => {
    const rowEl = document.getElementById(`row-${id}`);
    if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        rowEl.classList.add('highlight-row');
        rowEl.classList.add('highlight-flash');
        setTimeout(() => {
            rowEl.classList.remove('highlight-row');
            rowEl.classList.remove('highlight-flash');
        }, 2000);
    }
};



const renderBarChart = (preFounderPct, postFounderPct) => {
    const container = document.getElementById("bar-chart-container");
    if (!container) return;

    if (window.barChartInstance) {
        window.barChartInstance.destroy();
    }

    container.innerHTML = `
        <div class="chart-wrapper-bar">
            <canvas id="barChartCanvas"></canvas>
        </div>
    `;

    const preValid = !isNaN(preFounderPct) && isFinite(preFounderPct) && preFounderPct > 0;
    const postValid = !isNaN(postFounderPct) && isFinite(postFounderPct) && postFounderPct > 0;

    if (!preValid && !postValid) return;

    const labels = [
        ["After SAFE conversion", `Before ${state.roundName || "priced round"}`],
        ["After SAFE conversion", `and ${state.roundName || "priced round"}`]
    ];
    const data = [
        preValid ? preFounderPct * 100 : 0,
        postValid ? postFounderPct * 100 : 0
    ];

    const ctx = document.getElementById('barChartCanvas').getContext('2d');
    window.barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Founder Ownership',
                data: data,
                backgroundColor: ["#E5E5ED", "#5f17ea"],
                barPercentage: 0.5,
                categoryPercentage: 0.7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(0, 0, 0, 0.05)', drawBorder: false },
                    ticks: {
                        callback: (value) => value + "%",
                        font: { size: 11, family: "'Inter', sans-serif" },
                        color: '#64748B',

                        display: (context) => context.chart.height > 100
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 10, family: "'Inter', sans-serif", weight: '500' },
                        color: '#475569',
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: false,
                        display: (context) => context.chart.width > 120
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: '#ffffff',
                    titleColor: '#111827',
                    bodyColor: '#4B5563',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { size: 13, weight: '500', family: "'Inter', sans-serif" },
                    bodyFont: { size: 12, family: "'Inter', sans-serif" },
                    callbacks: {
                        label: (context) => ` Ownership: ${context.raw.toFixed(1)}%`
                    }
                }
            },
            layout: {
                padding: { top: 20, bottom: 40, left: 10, right: 10 }
            }
        },
        plugins: [{
            id: 'summaryText',
            afterDraw: (chart) => {
                const { ctx, chartArea: { left, width, bottom } } = chart;
                ctx.save();
                ctx.font = '500 14px Inter, sans-serif';
                ctx.fillStyle = '#444266';
                ctx.textAlign = 'center';
                const text = `${(preFounderPct * 100).toFixed(1)}% → ${(postFounderPct * 100).toFixed(1)}%`;
                ctx.fillText(text, left + width / 2, bottom + 75);
                ctx.restore();
            }
        }]
    });
};


let aiLoadingTimeout = null;

const renderAIAdvisor = (preRound, postRound, pricedConversion, state, strictlyPreFounderPct) => {
    const container = document.getElementById("ai-insights-container");
    if (!container) return;


    if (aiLoadingTimeout) clearTimeout(aiLoadingTimeout);

    const newMoneyRaised = pricedConversion.totalSeriesInvestment;
    const preMoney = state.preMoney;

    if (preMoney <= 0 || newMoneyRaised <= 0) {
        container.innerHTML = `<p class="card-subtext" style="font-family: 'Inter', sans-serif; font-size: 0.75rem; font-weight: 400; line-height: 1.5; color: #9ca3af; margin: 0.25rem 0 0 0;">Insights will appear once you enter your priced round terms.</p>`;
        return;
    }


    container.innerHTML = `
        <div class="ai-skeleton-loader" style="display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0;">
            <div class="ai-skeleton-line" style="width: 100%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
            <div class="ai-skeleton-line" style="width: 85%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
            <div class="ai-skeleton-line" style="width: 60%; height: 12px; background-color: #e2e8f0; border-radius: 4px;"></div>
        </div>
    `;


    aiLoadingTimeout = setTimeout(() => {
        const insights = [];
        const investment = ` <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${formatUSDWithCommas(newMoneyRaised)}</strong>`;
        const preMoneyStr = ` <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${formatUSDWithCommas(preMoney)}</strong>`;

        const foundersPost = postRound.common.filter((c) => c.category === "Founder");
        const totalFounderPctPost = foundersPost.reduce((a, f) => a + f.ownershipPct, 0);
        const totalFounderPctPre = strictlyPreFounderPct !== undefined ? strictlyPreFounderPct : 0;

        insights.push(`<p style="margin: 0 0 1.25rem 0; font-family: 'Inter', sans-serif; line-height: 1.6; font-size: 14px; color: #374151;">You are modeling a <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${state.roundName || "priced round"}</strong> round raising ${investment} at a ${preMoneyStr} pre-money valuation. Founder ownership changes from <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${safeFormatPercent(totalFounderPctPre)}</strong> to <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${safeFormatPercent(totalFounderPctPost)}</strong> post ${state.roundName || "priced round"}.</p>`);

        const safesCount = state.rowData.filter(r => r.type === CapTableRowType.Safe).length;
        const totalSafeInvestment = state.rowData
            .filter(r => r.type === CapTableRowType.Safe)
            .reduce((sum, s) => sum + s.investment, 0);

        if (safesCount > 0) {
            insights.push(`<p style="margin: 0 0 1.25rem 0; font-family: 'Inter', sans-serif; line-height: 1.6; font-size: 14px; color: #374151;">${safesCount} SAFE${safesCount > 1 ? 's' : ''} totaling <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${formatUSDWithCommas(totalSafeInvestment)}</strong> will convert.</p>`);
        }
        if (totalFounderPctPre >= 0.5 && totalFounderPctPost < 0.5) {
            insights.push(`
                <div class="insight-item" style="color: #0d0a40; margin: 0 0 1.25rem 0; font-family: 'Inter', sans-serif;">
                    <div class="insight-danger" style="color: #dc2626; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; margin-bottom: 20px;">Founders have dropped below 50% majority ownership in this round.</div>
                </div>
            `);
        }
        if (pricedConversion.increaseInOptionsPool > 0) {
            insights.push(`
                <div class="insight-item" style="color: #0d0a40; margin: 0 0 1.25rem 0; font-family: 'Inter', sans-serif;">
                    <div style="font-family: 'Inter', sans-serif; line-height: 1.6; font-size: 14px; color: #374151;">The model includes an option pool top-up to reach the target of <strong style="color: #0d0a40; font-weight: 600; font-family: 'Inter', sans-serif;">${state.targetOptionsPool}%</strong>, which issued additional shares pre ${state.roundName || "priced round"}.</div>
                </div>
            `);
        }
        container.innerHTML = insights.join("");
    }, 1000);
};

window.updateRow = (id, field, value) => {
    const row = state.rowData.find((r) => r.id === id);
    if (!row) return;
    if (field === "shares" || field === "investment" || field === "cap") {
        row[field] = stringToNumber(value);
    } else if (field === "discount") {
        row[field] = stringToNumber(value) / 100;
    } else {
        row[field] = value;
        if (field === "conversionType" && value === "mfn") {
            row.cap = 0;
            row.discount = 0;
        }
    }
    updateUI();
};

window.addRow = (type) => {
    const id = Date.now().toString() + "-" + Math.random().toString(36).substr(2, 9);
    if (type === "common") {
        state.rowData.push({
            id,
            type,
            name: "New Shareholder",
            shares: 0,
            category: "Investor",
        });
    } else if (type === CapTableRowType.Safe) {
        state.rowData.push({
            id,
            type,
            name: "New SAFE",
            investment: 0,
            cap: 0,
            discount: 0,
            conversionType: "post",
        });
    } else if (type === CapTableRowType.Series) {
        state.rowData.push({ id, type, name: "New Investor", investment: 0 });
    }
    updateUI();
};

window.deleteRow = (id) => {
    const row = state.rowData.find((r) => r.id === id);
    if (!row) return;

    if (id === "UnusedOptionsPool") {
        state.targetOptionsPool = 0;
        const targetInput = document.getElementById("target-options-input");
        if (targetInput) targetInput.value = "0";
    } else {
        if (row.type === CapTableRowType.Common) {
            const commonCount = state.rowData.filter(
                (r) => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool"
            ).length;
            if (commonCount <= 1) return;
        } else if (row.type === CapTableRowType.Safe) {
            const safeCount = state.rowData.filter((r) => r.type === CapTableRowType.Safe).length;
            if (safeCount <= 1) return;
        } else if (row.type === CapTableRowType.Series) {
            const seriesCount = state.rowData.filter((r) => r.type === CapTableRowType.Series).length;
            if (seriesCount <= 1) return;
        }
    }

    state.rowData = state.rowData.filter((r) => r.id !== id);
    updateUI();
};

window.togglePricedRound = () => {
    state.pricedRounds = state.pricedRounds === 0 ? 1 : 0;
    const btn = document.getElementById("toggle-priced-btn");
    if (btn) btn.textContent = state.pricedRounds > 0 ? "Remove Priced Round" : "Add Priced Round";
    updateUI();
};

window.updateGlobal = (field, value) => {
    if (field === "preMoney" || field === "targetOptionsPool") {
        state[field] = stringToNumber(value);
    } else {
        state[field] = value;
    }
    updateUI();
};

window.calculateSafeDiscount_UI = (btn) => {
    const id = btn.dataset.id;
    const safe = state.rowData.find(r => r.id === id);
    if (!safe) return;

    if (state.preMoney <= 0) {
        // Valuation error will already be shown by updateUI, but let's make sure it's clear
        updateUI(); 
        return;
    }

    if (safe.cap <= 0) {
        // Show error specifically for this SAFE
        renderSAFEs({ [safe.id]: "Enter a Valuation Cap first to calculate discount." });
        return;
    }

    // Formula: Discount = 1 - (Cap / Pre-money)
    let discount = 1 - (safe.cap / state.preMoney);
    
    // Clamp discount between 0 and 1 (0% to 100%)
    discount = Math.max(0, Math.min(1, discount));
    
    const discountPct = Math.round(discount * 100);
    
    updateRow(safe.id, 'discount', discountPct);
    
    showToast(`Discount calculated based on Cap: ${discountPct}%`, "success");
};

window.initSAFEApp = () => {
    try {
        updateUI();
    } catch (e) {
        console.error("Initialization error:", e);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    if (!window.manualInitSAFE) {
        window.initSAFEApp();
    }
});

/* 
================================================================
PART 3: PDF & INTEGRATION
Email, Toast, and PDF generation logic.
================================================================
*/
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message;
    toast.className = `toast-notification ${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

window.showEmailModal = function() {
    const modal = document.getElementById('email-modal');
    if (!modal) {
        console.error("Email modal element (#email-modal) not found. Ensure it exists in your Webflow project.");
        return;
    }
    const nameInput = document.getElementById('name-input');
    const emailInput = document.getElementById('email-input');
    const errorSpan = document.getElementById('email-error');
    
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (errorSpan) errorSpan.style.display = 'none';
    modal.style.display = 'flex';
    
    setTimeout(() => {
        if (nameInput) nameInput.focus();
        else if (emailInput) emailInput.focus();
    }, 100);
};

window.hideEmailModal = function() {
    const modal = document.getElementById('email-modal');
    if (modal) modal.style.display = 'none';
};

const normalizeForCapture = (element) => {
    const original = {
        position: element.style.position,
        top: element.style.top,
        height: element.style.height,
        maxHeight: element.style.maxHeight,
        overflow: element.style.overflow,
        overflowY: element.style.overflowY,
        width: element.style.width,
        boxShadow: element.style.boxShadow,
        borderRadius: element.style.borderRadius
    };

    const elementsToHide = element.querySelectorAll('.no-pdf, button, .btn-trash, .row-trash-btn');
    elementsToHide.forEach(el => {
        el.setAttribute('data-original-display', el.style.display || '');
        el.style.display = 'none';
    });
    
    element.style.position = 'static';
    element.style.top = 'auto';
    element.style.height = 'auto';
    element.style.maxHeight = 'none';
    element.style.overflow = 'visible';
    element.style.overflowY = 'visible';
    element.style.width = '100%';
    element.style.boxShadow = 'none';
    element.style.borderRadius = '0';
    
    return original;
};

const restoreAfterCapture = (element, original) => {
    const elementsToRestore = element.querySelectorAll('.no-pdf, button, .btn-trash, .row-trash-btn');
    elementsToRestore.forEach(el => {
        el.style.display = el.getAttribute('data-original-display') || '';
        el.removeAttribute('data-original-display');
    });

    Object.assign(element.style, original);
};

const checkPDFDependencies = () => {
    const hasJsPDF = !!(window.jspdf && window.jspdf.jsPDF);
    const hasHtml2Canvas = !!window.html2canvas;

    if (!hasJsPDF) {
        alert("Pdf download failed: jsPDF library not found. Please ensure the jsPDF script is included in your Webflow page settings.");
        console.error("Dependency Missing: jsPDF");
    }
    if (!hasHtml2Canvas) {
        alert("Pdf download failed: html2canvas library not found. Please ensure the html2canvas script is included in your Webflow page settings.");
        console.error("Dependency Missing: html2canvas");
    }
    return hasJsPDF && hasHtml2Canvas;
};

async function generateCombinedPDF(quality = 0.8, scale = 1.5) {
    if (!checkPDFDependencies()) return null;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;
    
    const primaryNavy = '#0d0a40';
    const textMuted = '#444266';
    
    doc.setFontSize(20);
    doc.setTextColor(primaryNavy);
    doc.setFont('helvetica', 'bold');
    doc.text('Calculator Inputs', margin, yPos);
    yPos += 8;
    
    doc.setFontSize(8);
    doc.setTextColor(textMuted);
    doc.setFont('helvetica', 'normal');
    const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    doc.text(`Generated on ${timestamp}`, margin, yPos);
    yPos += 10;

    const inputConfigs = [
        { id: 'cap-table-section', bodyId: 'shareholders-body', footerId: 'cap-table-footer' },
        { id: 'safes-section', bodyId: 'safes-body', footerId: null },
        { id: 'priced-round-section', bodyId: null, footerId: null, skipFooter: true }
    ];

    for (const config of inputConfigs) {
        const section = document.getElementById(config.id);
        if (!section) continue;

        const header = section.querySelector('.card-header');
        if (header) {
            const hStyles = normalizeForCapture(header);
            const hCanvas = await html2canvas(header, { backgroundColor: '#ffffff', scale: scale });
            restoreAfterCapture(header, hStyles);
            const hHeight = (hCanvas.height * contentWidth) / hCanvas.width;
            if (yPos + hHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
            doc.addImage(hCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, hHeight);
            yPos += hHeight + 2;
        }

        if (config.bodyId) {
            const body = document.getElementById(config.bodyId);
            if (body) {
                for (let row of body.children) {
                    const rStyles = normalizeForCapture(row);
                    const rCanvas = await html2canvas(row, { backgroundColor: '#ffffff', scale: scale });
                    restoreAfterCapture(row, rStyles);
                    const rHeight = (rCanvas.height * contentWidth) / rCanvas.width;
                    if (yPos + rHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
                    doc.addImage(rCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, rHeight);
                    yPos += rHeight + 2;
                }
            }
        } else if (config.id === 'priced-round-section') {
            const children = Array.from(section.children).filter(child => !child.classList.contains('card-header'));
            
            for (const child of children) {
                const cStyles = normalizeForCapture(child);
                const cCanvas = await html2canvas(child, { backgroundColor: '#ffffff', scale: scale });
                restoreAfterCapture(child, cStyles);
                const cHeight = (cCanvas.height * contentWidth) / cCanvas.width;
                if (yPos + cHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
                doc.addImage(cCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, cHeight);
                yPos += cHeight + 2;
            }
        }

        if (!config.skipFooter) {
            const footer = config.footerId ? document.getElementById(config.footerId) : section.querySelector('.card-footer-total');
            if (footer) {
                const fStyles = normalizeForCapture(footer);
                const fCanvas = await html2canvas(footer, { backgroundColor: '#ffffff', scale: scale });
                restoreAfterCapture(footer, fStyles);
                const fHeight = (fCanvas.height * contentWidth) / fCanvas.width;
                if (yPos + fHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
                doc.addImage(fCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, fHeight);
                yPos += fHeight + 10;
            }
        } else {
            yPos += 8;
        }
    }
    
    doc.addPage();
    yPos = margin;

    doc.setFontSize(20); doc.setTextColor(primaryNavy); doc.setFont('helvetica', 'bold');
    doc.text('SAFE Calculator Results', margin, yPos);
    yPos += 8;
    
    doc.setFontSize(8); doc.setTextColor(textMuted); doc.setFont('helvetica', 'normal');
    doc.text(`Generated on ${timestamp}`, margin, yPos);
    yPos += 10;
    
    const resultsCard = document.getElementById('results-card');
    if (resultsCard) {
        const cStyles = normalizeForCapture(resultsCard);
        const cCanvas = await html2canvas(resultsCard, { backgroundColor: '#ffffff', scale: scale });
        restoreAfterCapture(resultsCard, cStyles);
        const cHeight = (cCanvas.height * contentWidth) / cCanvas.width;
        if (yPos + cHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
        doc.addImage(cCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, cHeight);
        yPos += cHeight + 10;
    }

    const aiAdvisor = document.getElementById('ai-advisor-section');
    if (aiAdvisor) {
        const hStyles = normalizeForCapture(aiAdvisor);
        const hCanvas = await html2canvas(aiAdvisor, { backgroundColor: '#ffffff', scale: scale });
        restoreAfterCapture(aiAdvisor, hStyles);
        const hHeight = (hCanvas.height * contentWidth) / hCanvas.width;
        if (yPos + hHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
        doc.addImage(hCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, hHeight);
        yPos += hHeight + 10;
    }

    const breakdown = document.getElementById('breakdown-section');
    if (breakdown) {
        const title = breakdown.querySelector('.subsection-title');
        if (title) {
            const tStyles = normalizeForCapture(title);
            const tCanvas = await html2canvas(title, { backgroundColor: '#ffffff', scale: scale });
            restoreAfterCapture(title, tStyles);
            const tHeight = (tCanvas.height * contentWidth) / tCanvas.width;
            if (yPos + tHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
            doc.addImage(tCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, tHeight);
            yPos += tHeight + 2;
        }

        const table = breakdown.querySelector('table');
        if (table) {
            const thead = table.querySelector('thead');
            if (thead) {
                const thStyles = normalizeForCapture(thead);
                const thCanvas = await html2canvas(thead, { backgroundColor: '#ffffff', scale: scale });
                restoreAfterCapture(thead, thStyles);
                const thHeight = (thCanvas.height * contentWidth) / thCanvas.width;
                if (yPos + thHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
                doc.addImage(thCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, thHeight);
                yPos += thHeight;
            }

            const tbody = table.querySelector('tbody');
            if (tbody) {
                for (let row of tbody.children) {
                    const rCanvas = await html2canvas(row, { backgroundColor: '#ffffff', scale: scale });
                    const rHeight = (rCanvas.height * contentWidth) / rCanvas.width;
                    if (yPos + rHeight > pageHeight - margin) { doc.addPage(); yPos = margin; }
                    doc.addImage(rCanvas.toDataURL('image/jpeg', quality), 'JPEG', margin, yPos, contentWidth, rHeight);
                    yPos += rHeight;
                }
            }
        }
    }
    
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor('#9ca3af');
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
    }
    return doc;
}

const prepareReportData = () => {
    const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.textContent : '0';
    };

    const founderOwnership = getVal('founder-ownership-val');
    const founderDilution = getVal('founder-dilution-val');
    const postMoney = getVal('post-money-val');

    const totalRaisedVal = state.rowData
        .filter(r => r.type === CapTableRowType.Safe || r.type === CapTableRowType.Series)
        .reduce((sum, r) => sum + (r.investment || 0), 0);
    const totalRaised = formatUSDWithCommas(totalRaisedVal);

    // =========================================================================
    // SNAPSHOT 2: PRE-ROUND (Post-SAFE)
    // =========================================================================
    const preRound = buildEstimatedPreRoundCapTable(state.rowData);

    // =========================================================================
    // SNAPSHOT 3: POST-ROUND
    // =========================================================================
    const rawSafes = state.rowData.filter(r => r.type === CapTableRowType.Safe);
    const populatedSafes = populateSafeCaps(rawSafes);
    const seriesInvs = state.rowData
        .filter(r => r.type === CapTableRowType.Series)
        .map(r => r.investment);

    const unusedOptionsValue = state.rowData.find(r => r.id === "UnusedOptionsPool")?.shares || 0;
    const commonSharesOnly = state.rowData.filter(r => r.type === CapTableRowType.Common && r.id !== "UnusedOptionsPool").reduce((sum, r) => sum + r.shares, 0);

    const pricedConversion = fitConversion(
        state.preMoney,
        commonSharesOnly,
        populatedSafes,
        unusedOptionsValue,
        state.targetOptionsPool,
        seriesInvs
    );

    const pricedTable = buildPricedRoundCapTable(pricedConversion, state.rowData);

    const rows = [
        ...pricedTable.common.map(r => ({
            name: r.name,
            preShares: preRound.common.find(pr => pr.id === r.id)?.shares || r.shares,
            postShares: r.shares,
            badge: null,
            isFounder: r.category === "Founder",
            isSafe: false,
            isInvestor: false
        })),
        ...pricedTable.safes.map(r => {
            let badge = null;
            let badgeStyle = "";
            const safeMatch = populatedSafes.find(s => s.id === r.id);
            
            if (isMFN(r)) {
                badge = "MFN SAFE";
                badgeStyle = "border-[#fecaca] bg-[#fee2e2] text-[#991b1b]";
            } else if (r.conversionType === "pre") {
                badge = "Pre-money SAFE";
                badgeStyle = "border-[#fde68a] bg-[#fef3c7] text-[#92400e]";
            } else if (r.conversionType === "post") {
                badge = "Post-money SAFE";
                badgeStyle = "border-[#a7f3d0] bg-[#d1fae5] text-[#065f46]";
            }
            
            return {
                name: r.name,
                preShares: preRound.safes.find(ps => ps.id === r.id)?.shares || 0,
                postShares: r.shares,
                badge: badge,
                badgeStyle: badgeStyle,
                isFounder: false,
                isSafe: true,
                isInvestor: false,
                investment: r.investment,
                cap: safeMatch?.cap || 0,
                discount: r.discount ? (r.discount * 100).toFixed(0) + "%" : "None",
                type: r.conversionType ? r.conversionType.charAt(0).toUpperCase() + r.conversionType.slice(1) + "-money" : "N/A"
            };
        }),
        ...pricedTable.series.map(r => ({
            name: r.name,
            preShares: 0,
            postShares: r.shares,
            badge: null,
            badgeStyle: "",
            isFounder: false,
            isSafe: false,
            isInvestor: true,
            investment: r.investment
        }))
    ];

    if (pricedTable.refreshedOptionsPool && pricedTable.refreshedOptionsPool.shares > 0) {
        const preOptions = unusedOptionsValue;
        const postOptions = pricedTable.refreshedOptionsPool.shares;
        
        let badge = null;
        let badgeStyle = "";
        
        if (postOptions > preOptions + 1) {
            badge = "Pool top-up";
            badgeStyle = "border-[#c7d2fe] bg-[#e0e7ff] text-[#3730a3]";
        }

        rows.push({
            name: "Option pool",
            preShares: preOptions,
            postShares: postOptions,
            badge: badge,
            badgeStyle: badgeStyle,
            isFounder: false,
            isSafe: false,
            isInvestor: false
        });
    }

    const commonSharesTotalPre = preRound.total.shares;
    const founderSharesPre = preRound.common
        .filter((c) => c.category === "Founder")
        .reduce((a, c) => a + c.shares, 0);
    const totalFounderPctPre = commonSharesTotalPre > 0 ? founderSharesPre / commonSharesTotalPre : 0;
    const ownershipPre = safeFormatPercent(totalFounderPctPre);

    return {
        valuation: state.preMoney,
        raised: totalRaisedVal,
        safeAmount: state.rowData.filter(r => r.type === CapTableRowType.Safe).reduce((sum, r) => sum + (r.investment || 0), 0),
        timestamp: timestamp,
        optionPool: state.targetOptionsPool + "%",
        roundName: state.roundName || "priced round",
        summary: {
            ownershipPre: ownershipPre,
            ownershipPost: founderOwnership,
            dilution: founderDilution,
            postMoney: postMoney,
            pricePerShare: getVal('round-pps-val'),
            totalShares: getVal('total-post-shares-val'),
            totalRaised: totalRaised
        },
        rows: rows
    };
};

window.downloadPDF = async function() {
    try {
        console.log("Starting PDF download flow...");
        showToast('Generating report...', 'success');
        const reportData = prepareReportData();

        console.log("Fetching from backend at http://127.0.0.1:3006/generate-pdf...");
        const response = await fetch('https://safe-calculator-backend-production-ebb2.up.railway.app/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportData })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server responded with ${response.status}: ${errText}`);
        }

        const result = await response.json();
        console.log("Response received from backend:", result.success ? "Success" : "Failure");

        if (result.success) {
            const pdfBase64 = result.pdfBase64;
            const byteCharacters = atob(pdfBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `SAFE_Calculator_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast('Report downloaded!', 'success');
        } else {
            throw new Error(result.message || "Backend failed to generate PDF");
        }
    } catch (error) {
        console.error("PDF Download Error:", error);
        alert(`PDF Download Failed: ${error.message}\n\nPlease ensure the backend server is running in the 'backend' folder.`);
        showToast('Error generating PDF', 'error');
    }
};

let modalMode = 'email'; // 'email' or 'download'

window.showEmailModal = function(mode = 'email') {
    modalMode = mode;
    const modal = document.getElementById('email-modal');
    if (!modal) return;
    
    // Reset recipients list to just one if not already
    const list = document.getElementById('email-recipients-list');
    if (list) {
        list.innerHTML = `
            <div class="recipient-row" id="recipient-row-0">
                <input
                    type="email"
                    class="input email-recipient-input"
                    placeholder="work@company.com"
                    required
                />
                <button class="btn-remove-recipient" style="visibility: hidden" type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
    }

    // Update button text and recipient options based on mode
    const btnText = document.getElementById('send-btn-text');
    const recipientLabel = document.getElementById('recipient-label');
    const addRecipientBtn = document.getElementById('add-recipient-btn');
    const modalTitle = document.getElementById('modal-title');

    if (btnText) {
        btnText.textContent = mode === 'download' ? 'Download the report' : 'Email the report';
    }

    if (modalTitle) {
        modalTitle.textContent = mode === 'download' ? 'Download the ownership report' : 'Get a copy of ownership report on your email';
    }

    if (recipientLabel) {
        recipientLabel.textContent = mode === 'download' ? 'Work email' : 'Work email(s)';
    }

    if (addRecipientBtn) {
        addRecipientBtn.style.display = mode === 'download' ? 'none' : 'inline-flex';
    }
    
    const firstNameInput = document.getElementById('first-name-input');
    const firstEmailInput = document.querySelector('.email-recipient-input');
    const errorSpan = document.getElementById('email-error');
    
    if (errorSpan) errorSpan.style.display = 'none';
    modal.style.display = 'flex';
    
    setTimeout(() => {
        if (firstNameInput) firstNameInput.focus();
        else if (firstEmailInput) firstEmailInput.focus();
    }, 100);
};

window.addRecipient = function() {
    const list = document.getElementById('email-recipients-list');
    if (!list) return;
    
    const id = Date.now();
    const row = document.createElement('div');
    row.className = 'recipient-row';
    row.id = `recipient-row-${id}`;
    row.innerHTML = `
        <input
            type="email"
            class="input email-recipient-input"
            placeholder="work@company.com"
        />
        <button class="btn-remove-recipient" onclick="removeRecipient('${id}')" type="button" title="Remove recipient">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
    `;
    list.appendChild(row);
    row.querySelector('input').focus();
};

window.removeRecipient = function(id) {
    const row = document.getElementById(`recipient-row-${id}`);
    if (row) row.remove();
};

window.hideEmailModal = function() {
    const modal = document.getElementById('email-modal');
    if (modal) modal.style.display = 'none';
};

window.sendEmailWithPDF = async function() {
    const firstNameInput = document.getElementById('first-name-input');
    const lastNameInput = document.getElementById('last-name-input');
    const companyInput = document.getElementById('company-input');
    const newsletterCheckbox = document.getElementById('newsletter-checkbox');
    const emailInputs = document.querySelectorAll('.email-recipient-input');
    const errorSpan = document.getElementById('email-error');
    const sendBtn = document.getElementById('send-email-btn');
    const btnText = document.getElementById('send-btn-text');
    const btnLoader = document.getElementById('send-btn-loader');
    
    const firstName = firstNameInput ? firstNameInput.value.trim() : '';
    const lastName = lastNameInput ? lastNameInput.value.trim() : '';
    const company = companyInput ? companyInput.value.trim() : '';
    const subscribe = newsletterCheckbox ? newsletterCheckbox.checked : false;
    
    const emails = Array.from(emailInputs)
        .map(input => input.value.trim())
        .filter(email => email !== '');

    if (emails.length === 0) {
        errorSpan.textContent = 'Please enter at least one email address';
        errorSpan.style.display = 'block';
        return;
    }

    const invalidEmail = emails.find(email => !validateEmail(email));
    if (invalidEmail) {
        errorSpan.textContent = `"${invalidEmail}" is not a valid email address`;
        errorSpan.style.display = 'block';
        return;
    }
    
    errorSpan.style.display = 'none';
    sendBtn.disabled = true;
    const originalBtnText = btnText.textContent;
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-flex';
    if (btnLoader.querySelector('span')) {
        btnLoader.querySelector('span').textContent = modalMode === 'download' ? 'Generating...' : 'Sending...';
    }
    
    try {
        const reportData = prepareReportData();
        const primaryEmail = emails[0];
        const payload = {
            to_email: emails, // Now passing an array
            reportData: reportData,
            summaryData: {
                firstName: firstName || 'there',
                lastName: lastName,
                companyName: company,
                subscribe: subscribe,
                founderOwnership: reportData.summary.ownershipPost,
                founderDilution: reportData.summary.dilution,
                postMoney: reportData.summary.postMoney,
                totalRaised: reportData.summary.totalRaised
            }
        };

        if (modalMode === 'download') {
            const response = await fetch('https://safe-calculator-backend-production-ebb2.up.railway.app/generate-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportData, leadData: payload.summaryData, to_email: primaryEmail })
            });

            if (!response.ok) throw new Error('Failed to generate PDF');
            const result = await response.json();
            
            if (result.success) {
                const byteCharacters = atob(result.pdfBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `SAFE_Calculator_Report_${new Date().toISOString().split('T')[0]}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Report downloaded!', 'success');
                hideEmailModal();
            } else {
                throw new Error(result.message);
            }
        } else {
            showToast('Sending...', 'success');
            const emailResponse = await fetch('https://safe-calculator-backend-production-ebb2.up.railway.app/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await emailResponse.json();
            if (result.success) {
                hideEmailModal();
                showToast('Email sent successfully!', 'success');
            } else {
                throw new Error(result.message);
            }
        }
    } catch (error) {
        console.error('Action Error:', error);
        showToast('Error. Is the backend running?', 'error');
    } finally {
        sendBtn.disabled = false;
        btnText.style.display = 'inline';
        btnText.textContent = originalBtnText;
        btnLoader.style.display = 'none';
    }
};



document.addEventListener('click', function(event) {
    const modal = document.getElementById('email-modal');
    if (event.target === modal) {
        hideEmailModal();
    }
});


document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const modal = document.getElementById('email-modal');
        if (modal.style.display === 'flex') {
            hideEmailModal();
        }
    }
});
