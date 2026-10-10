import 'quasar/dist/quasar.css';

import { Quasar } from 'quasar';
//config
const config = {};

//components
import { QLinearProgress, QInput, QBtn, QBtnToggle, QIcon, QTabs, QTab, QItem, QItemSection, QItemLabel, QTooltip, QCheckbox, QSelect, QPopupProxy, QDate, QDialog, QTree, QOptionGroup, QKnob } from 'quasar';


const components = {
    //QLayout,
    //QPageContainer, QPage,
    //QDrawer,

    //QCircularProgress,
    QLinearProgress,
    QInput,
    QBtn,
    //QBtnGroup,
    QBtnToggle,
    QIcon,
    //QSlider,
    QTabs, QTab,
    //QTabPanels, QTabPanel,
    //QSeparator,
    //QList,
    QItem, QItemSection, QItemLabel,
    QTooltip,
    //QSpinner,
    //QTable, QTh, QTr, QTd,
    QCheckbox,
    QSelect,
    //QColor,
    QPopupProxy,
    QDate,
    QDialog,
    //QChip,
    QTree,
    //QExpansionItem,
    //QVirtualScroll,
    QOptionGroup,
    QKnob,
};

//directives & plugins
import {Ripple,ClosePopup,Notify} from 'quasar';

const directives = {Ripple, ClosePopup};

//plugins
//import AppFullscreen from 'quasar/src/plugins/AppFullscreen';

const plugins = {
    //AppFullscreen,
    Notify,
};

//icons
//import '@quasar/extras/fontawesome-v5/fontawesome-v5.css';
//import fontawesomeV5 from 'quasar/icon-set/fontawesome-v5.js'

import lang from 'quasar/lang/ru';
import '@quasar/extras/line-awesome/line-awesome.css';
import lineAwesome from 'quasar/icon-set/line-awesome.js'

export default {
    quasar: Quasar,
    options: { config, components, directives, plugins, lang }, 
    init: () => {
        Quasar.iconSet.set(lineAwesome);
}
};