// initial state
const state = {
    config: {},
    settings: {
        accessToken: '',
        extendedParams: false,
        expandedAuthor: [],
        expandedSeries: [],

        defaultsSet: false,
        
        //uiDefaults
        limit: 20,
        downloadAsZip: false,
        showCounts: true,
        showRates: true,
        showInfo: true,
        showGenres: true,
        showDates: false,
        showDeleted: false,
        abCacheEnabled: true,
        langDefault: '',
        showJson: false,
        showNewReleaseAvailable: true,
    },    
    favoriteUids: new Set(),
};

// getters
const getters = {};

// actions
const actions = {};

// mutations
const mutations = {
    setConfig(state, value) {
        state.config = value;
    },
    setSettings(state, value) {
        state.settings = Object.assign({}, state.settings, value);
    },
    // избранное
    setFavoriteUids(state, uids) {
        state.favoriteUids = new Set(uids || []);
    },
    addFavoriteUid(state, uid) {
        const s = new Set(state.favoriteUids);
        s.add(uid);
        state.favoriteUids = s;
    },
    removeFavoriteUid(state, uid) {
        const s = new Set(state.favoriteUids);
        s.delete(uid);
        state.favoriteUids = s;
    },
};

export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
};
