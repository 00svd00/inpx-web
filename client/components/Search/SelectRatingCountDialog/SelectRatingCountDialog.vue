<template>
    <Dialog ref="dialog" v-model="dialogVisible">
        <template #header>
            <div style="font-size: 110%">
                Число оценок
            </div>
        </template>

        <div class="column q-mt-xs" style="min-width: 260px; padding: 0px 10px 10px 10px;">
            <div class="row items-center">
                <q-input
                    v-model="from"
                    class="q-mt-xs col" style="min-width: 100px;" label="От" stack-label outlined dense clearable
                    @keydown="onKeyDown"
                />
                <div class="q-mx-sm" style="font-size: 120%">—</div>
                <q-input
                    v-model="to"
                    class="q-mt-xs col" style="min-width: 100px;" label="До" stack-label outlined dense clearable
                    @keydown="onKeyDown"
                />
            </div>
            <div class="row q-mt-xs q-ml-sm" style="color: red" v-html="error" />
        </div>

        <template #footer>
            <q-btn class="q-px-md q-ml-sm" color="primary" dense no-caps :disabled="error !== ''" @click="apply">
                Применить
            </q-btn>
        </template>
    </Dialog>
</template>

<script>
//-----------------------------------------------------------------------------
import vueComponent from '../../vueComponent.js';

import Dialog from '../../share/Dialog.vue';

const componentOptions = {
    components: { Dialog },
    watch: {
        modelValue(newValue) {
            this.dialogVisible = newValue;
        },
        dialogVisible(newValue) {
            this.$emit('update:modelValue', newValue);
        },
        ratingCount: {
            handler(newValue) {
                this.parseValue(newValue);
            },
        },
        from(newValue) {
            const cleaned = (newValue || '').replace(/\D/g, '');
            if (cleaned !== newValue)
                this.from = cleaned;
            this.validate();
        },
        to(newValue) {
            const cleaned = (newValue || '').replace(/\D/g, '');
            if (cleaned !== newValue)
                this.to = cleaned;
            this.validate();
        },
    }
};
class SelectRatingCountDialog {
    _options = componentOptions;
    _props = {
        modelValue: Boolean,
        ratingCount: String,
    };

    dialogVisible = false;

    from = '';
    to = '';
    error = '';

    created() {
        this.parseValue(this.ratingCount);
    }

    parseValue(value) {
        const v = (value || '').trim();
        if (!v) {
            this.from = '';
            this.to = '';
            return;
        }

        const parts = v.split('..');
        if (parts.length === 1) {
            this.from = parts[0];
            this.to = parts[0];
        } else {
            this.from = parts[0];
            this.to = parts[1];
        }
    }

    validate() {
        let error = [];
        if (this.from && this.to && parseInt(this.from, 10) > parseInt(this.to, 10))
            error.push('«От» не может быть больше «До»');
        this.error = error.join('<br>');
    }

    onKeyDown(event) {
        if (event.code == 'Enter')
            this.apply();
    }

    apply() {
        this.validate();
        if (this.error)
            return;

        let value = '';
        if (this.from && this.to) {
            if (this.from === this.to)
                value = this.from;
            else
                value = `${this.from}..${this.to}`;
        } else if (this.from) {
            value = `${this.from}..`;
        } else if (this.to) {
            value = `..${this.to}`;
        }

        this.$emit('update:ratingCount', value);
        this.dialogVisible = false;
    }
}

export default vueComponent(SelectRatingCountDialog);
//-----------------------------------------------------------------------------
</script>