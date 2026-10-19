<template>
    <div>
        <a ref="download" style="display: none;"></a>

        <LoadingMessage :message="loadingMessage" z-index="2" />
        <LoadingMessage :message="loadingMessage2" z-index="1" />

        <div v-if="error" class="text-red q-pa-md">
            {{ error }}
        </div>
        <div v-else-if="!loadingMessage && !tableData.length" class="text-center q-pa-lg text-grey">
            Полка пуста, скачайте книгу
        </div>
        <div v-else>
            <div v-if="tableData.length" class="text-grey-7 q-mb-sm">
                Найдено: {{ totalFound }}
            </div>
            <BookView
                v-for="book in tableData"
                :key="book._uid"
                :book="book"
                favorite-action="remove"
                :genre-map="genreMap"
                :show-deleted="showDeleted"
                :show-rates="showRates"
                :show-genres="showGenres"
                :show-read-link="showReadLink"
                @book-event="bookEvent"
            />
        </div>
    </div>
</template>

<script>
import vueComponent from '../../vueComponent.js';
import BaseList, { baseListOptions } from '../BaseList.js';
import BookView from '../BookView/BookView.vue';
import LoadingMessage from '../LoadingMessage/LoadingMessage.vue';

const componentOptions = Object.assign({}, baseListOptions, {
    components: {
        BookView,
        LoadingMessage,
    },
});
class FavoritesList extends BaseList {
    _options = componentOptions;

    totalFound = 0;
    allFavorites = null;

    async refresh() {
        const search = this.search;
        const hasFilter = !!(search.author || search.series || search.title || search.genre ||
                            search.lang || search.date || search.librate || search.ext);

        this.loadingMessage = 'Загрузка избранного...';
        this.error = '';

        try {
            const page = search.page || 1;
            const limit = search.limit || 50;
            const offset = (page - 1)*limit;

            if (hasFilter) {
                // с фильтром: загружаем всё (один раз), фильтруем, пагинируем локально
                if (!this.allFavorites) {
                    const result = await this.api.getFavorites(0, 0); // 0 = все
                    this.allFavorites = (result.books || []).filter(b => !b.deleted);
                }

                const filtered = this.filterBooks(this.allFavorites);
                this.tableData = filtered.slice(offset, offset + limit);
                this.totalFound = filtered.length;
            } else {
                // без фильтра: пагинация на сервере
                this.allFavorites = null; // сброс кэша

                const result = await this.api.getFavorites(offset, limit);
                this.tableData = (result.books || []).filter(b => !b.deleted);
                this.totalFound = result.total || 0;
            }

            this.$emit('listEvent', {action: 'totalFound', data: this.totalFound});
        } catch (e) {
            this.error = e.message;
        } finally {
            this.loadingMessage = '';
        }
    }
    async favoriteRemove(book) {
        try {
            await this.api.removeFavorite(book._uid);
            this.commit('removeFavoriteUid', book._uid);
            this.$root.notify.success('Удалено из избранного');
            const i = this.tableData.findIndex(b => b._uid === book._uid);
            if (i >= 0)
                this.tableData.splice(i, 1);
        } catch (e) {
            this.$root.stdDialog.alert(e.message, 'Ошибка');
        }
    }
}

export default vueComponent(FavoritesList);
</script>