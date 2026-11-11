<template>
    <Dialog ref="dialog" v-model="dialogVisible">
        <template #header>
            <div class="row items-center">
                <div style="font-size: 110%">
                    Выбрать жанры
                </div>
            </div>
        </template>

        <div ref="box" class="column q-mt-xs overflow-auto no-wrap" style="width: 370px; padding: 0px 10px 10px 10px;">
            <div class="row items-center top-panel bg-grey-3">
                <q-input ref="search" v-model="search" class="col" outlined dense bg-color="white" placeholder="Найти" clearable />
            </div>
            <q-tree
                v-model:expanded="expanded"
                class="q-my-xs"
                :nodes="nodes"
                node-key="key"
                selected-color="black"
                :filter="search"
                no-nodes-label="Жанров нет"
                no-results-label="Ничего не найдено"
            >
                <template #default-header="prop">
                    <div class="row items-center full-width genre-node" @click.stop>
                        <q-checkbox
                            :model-value="clickState(prop.node)"
                            :true-value="'include'"
                            :false-value="'neutral'"
                            :indeterminate-value="'exclude'"
                            toggle-indeterminate
                            toggle-order="ft"
                            size="36px"
                            class="q-mr-sm"
                            @update:model-value="onCheckboxUpdate(prop.node, $event)"
                        />
                        <div
                            class="col genre-label"
                            :class="{
                                'text-green-6 text-weight-bold': displayState(prop.node) === 'include',
                                'text-red-6 text-weight-bold': displayState(prop.node) === 'exclude',
                                'text-amber-8 text-weight-bold': displayState(prop.node) === 'mixed',
                            }"
                        >{{ prop.node.label }}</div>
                    </div>
                </template>
            </q-tree>
        </div>

        <template #footer>
            <q-btn class="q-px-md q-ml-sm" color="primary" dense no-caps @click="okClick">
                OK
            </q-btn>
        </template>
    </Dialog>
</template>

<script>
//-----------------------------------------------------------------------------
import vueComponent from '../../vueComponent.js';

import Dialog from '../../share/Dialog.vue';

const componentOptions = {
    components: {
        Dialog
    },
    watch: {
        modelValue(newValue) {
            this.dialogVisible = newValue;
            if (newValue)
                this.init();//no await
        },
        dialogVisible(newValue, oldValue) {
            this.$emit('update:modelValue', newValue);
            if (oldValue === true && newValue === false)
                this.emitGenres();
        },
        genre() {
            this.updateFromProps();
        },
        excludeGenre() {
            this.updateFromProps();
        },
    }
};
class GenreSelectDialog {
    _options = componentOptions;
    _props = {
        modelValue: Boolean,
        genre: {type: String, value: ''},
        excludeGenre: {type: String, value: ''},
        genreTree: Array,
    };

    dialogVisible = false;

    search = '';
    expanded = [];

    includeSet = new Set();
    excludeSet = new Set();

    created() {
    }

    mounted() {
        this.updateFromProps();
    }

    async init() {
        await this.$refs.dialog.waitShown();
        //чтобы не скакало при поиске
        this.$refs.box.style.height = `${document.body.clientHeight - 160}px`;
    }

    get nodes() {
        const result = [];

        for (const section of this.genreTree) {
            const sec = {label: section.name, key: `r-${section.name}`, children: []};
            for (const g of section.value) {
                sec.children.push({label: g.name, key: g.value});
            }
            result.push(sec);
        }

        return result;
    }

    isSection(node) {
        return !!(node.children && node.children.length);
    }

    // состояние листа
    stateOf(key) {
        if (this.includeSet.has(key))
            return 'include';
        if (this.excludeSet.has(key))
            return 'exclude';
        return 'neutral';
    }

    // состояние секции: include (все), exclude (все), neutral (все), mixed (иначе)
    stateOfSection(section) {
        const states = section.children.map(l => this.stateOf(l.key));
        const allInc = states.length && states.every(s => s === 'include');
        const allExc = states.length && states.every(s => s === 'exclude');
        const allNeu = states.length && states.every(s => s === 'neutral');
        if (allInc) return 'include';
        if (allExc) return 'exclude';
        if (allNeu) return 'neutral';
        return 'mixed';
    }

    displayState(node) {
        return this.isSection(node) ? this.stateOfSection(node) : this.stateOf(node.key);
    }

    clickState(node) {
        const s = this.displayState(node);
        // q-checkbox знает только три состояния; mixed мапим в exclude,
        // чтобы клик из «смешанного» дал neutral (очистку)
        return s === 'mixed' ? 'exclude' : s;
    }

    onCheckboxUpdate(node, newState) {
        // newState: 'include' | 'exclude' | 'neutral' (из toggle-indeterminate)
        if (this.isSection(node)) {
            for (const leaf of node.children) {
                if (newState === 'include') {
                    this.includeSet.add(leaf.key);
                    this.excludeSet.delete(leaf.key);
                } else if (newState === 'exclude') {
                    this.includeSet.delete(leaf.key);
                    this.excludeSet.add(leaf.key);
                } else {
                    this.includeSet.delete(leaf.key);
                    this.excludeSet.delete(leaf.key);
                }
            }
        } else {
            if (newState === 'include') {
                this.includeSet.add(node.key);
                this.excludeSet.delete(node.key);
            } else if (newState === 'exclude') {
                this.includeSet.delete(node.key);
                this.excludeSet.add(node.key);
            } else {
                this.includeSet.delete(node.key);
                this.excludeSet.delete(node.key);
            }
        }
    }

    updateFromProps() {
        this.includeSet = new Set((this.genre || '').split(',').filter(Boolean));
        this.excludeSet = new Set((this.excludeGenre || '').split(',').filter(Boolean));
    }

    emitGenres() {
        this.$emit('update:genre', Array.from(this.includeSet).join(','));
        this.$emit('update:excludeGenre', Array.from(this.excludeSet).join(','));
    }

    okClick() {
        this.dialogVisible = false;
    }
}

export default vueComponent(GenreSelectDialog);
//-----------------------------------------------------------------------------
</script>

<style scoped>
.top-panel {
    border-radius: 10px;
    padding: 5px;
}

.genre-node {
    min-height: 28px;
}
</style>