import { createStore } from 'vuex';
import VuexPersistence from 'vuex-persist';

import root from './root.js';

const debug = process.env.NODE_ENV !== 'production';

const vuexLocal = new VuexPersistence({
    reducer: (state) => ({
        config: state.config,
        settings: state.settings,
        // favoriteUids не сохраняем — данные сессии
    }),
});

export default createStore(Object.assign({}, root, {
    modules: {
    },
    strict: debug,
    plugins: [vuexLocal.plugin]
}));
