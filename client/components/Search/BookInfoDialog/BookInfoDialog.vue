<template>
    <Dialog ref="dialog" v-model="dialogVisible">
        <template #header>
            <div class="row items-center">
                <div style="font-size: 110%">
                    Информация о книге
                </div>
            </div>
        </template>

        <div ref="box" class="fit column q-mt-xs overflow-auto no-wrap" style="padding: 0px 10px 10px 10px;">
            <div class="text-green-10">
                {{ bookAuthor }}
            </div>
            <div>
                <b>{{ book.title }}</b>
            </div>

            <div class="row q-mt-sm no-wrap">
                <div class="poster-size">
                    <div class="column justify-center items-center" :class="{'poster': coverSrc, 'no-poster': !coverSrc}" @click.stop.prevent="posterClick">
                        <img v-if="coverSrc" :src="coverSrc" class="fit row justify-center items-center" style="object-fit: contain" @error="coverSrc = ''" />
                        <div v-if="!coverSrc" class="fit row justify-center items-center text-grey-5 overflow-hidden" style="border: 1px solid #ccc; font-size: 300%">
                            <i>{{ book.ext }}</i>
                        </div>
                    </div>
                </div>

                <div class="col column q-ml-sm" style="min-width: 400px; border: 1px solid #ccc">
                    <div class="bg-grey-3 row">
                        <q-tabs
                            v-model="selectedTab"
                            active-color="black"
                            active-bg-color="white"
                            indicator-color="white"
                            dense
                            no-caps
                            inline-label
                            class="bg-grey-4 text-grey-7"
                        >
                            <q-tab v-if="fb2.length" name="fb2" label="Fb2 инфо" />
                            <q-tab name="inpx" label="Inpx инфо" />
                            <q-tab v-if="reviewsAvailable" name="reviews" :label="reviewsTabLabel" />
                            <q-tab v-if="authorsBioAvailable" name="authors" :label="authorsTabLabel" />
                        </q-tabs>
                    </div>

                    <div class="overflow-auto full-width" style="height: 262px">
                        <!-- fb2 / inpx -->
                        <template v-if="selectedTab === 'fb2' || selectedTab === 'inpx'">
                            <div v-for="item in info" :key="item.name">
                                <div class="row q-ml-sm q-mt-sm items-center">
                                    <div class="text-blue" style="font-size: 90%">
                                        {{ item.label }}
                                    </div>
                                    <div class="col q-mx-xs" style="height: 0px; border-top: 1px solid #ccc"></div>
                                </div>

                                <div v-for="subItem in item.value" :key="subItem.name" class="row q-ml-md">
                                    <div style="width: 100px">
                                        {{ subItem.label }}
                                    </div>
                                    <div class="q-ml-sm" v-html="subItem.value" />
                                </div>
                            </div>
                        </template>

                        <!-- reviews -->
                        <template v-else-if="selectedTab === 'reviews'">
                            <div v-if="reviewsLoading" class="q-pa-md text-center text-grey">
                                Загрузка рецензий...
                            </div>
                            <div v-else-if="reviewsError" class="q-pa-md text-red">
                                {{ reviewsError }}
                            </div>
                            <div v-else>
                                <div class="q-pa-sm text-grey-7" style="font-size: 90%">
                                    Рецензий: <b>{{ reviews.foundCount }}</b>,
                                    оценок: <b>{{ reviews.declaredCount }}</b><span v-if="avgRating">, средняя: <b>{{ avgRating }}</b></span>
                                </div>
                                <div v-for="(review, i) in reviews.reviews" :key="i" class="q-pa-sm" style="border-top: 1px solid #eee">
                                    <div class="text-grey-7" style="font-size: 85%">
                                        {{ review.name || 'Аноним' }} — {{ review.time }}
                                    </div>
                                    <div v-html="review.text" style="text-align: justify" />
                                </div>
                                <div v-if="!reviews.reviews.length" class="q-pa-md text-center text-grey">
                                    Рецензии не найдены
                                </div>
                            </div>
                        </template>

                        <!-- authors -->
                        <template v-else-if="selectedTab === 'authors'">
                            <div v-if="authorsLoading" class="q-pa-md text-center text-grey">
                                Загрузка авторов...
                            </div>
                            <div v-else-if="authorsError" class="q-pa-md text-red">
                                {{ authorsError }}
                            </div>
                            <div v-else>
                                <div v-for="(author, i) in authors" :key="i" class="q-pa-sm" style="border-top: 1px solid #eee">
                                    <div class="row items-start no-wrap">
                                        <img
                                            v-if="author.found"
                                            :src="authorPhotoUrl(author.hash)"
                                            class="q-mr-sm"
                                            style="width: 80px; height: 80px; object-fit: cover"
                                            @error="$event.target.style.display = 'none'"
                                        />
                                        <div class="col">
                                            <div class="text-grey-7" style="font-size: 95%">
                                                <b>{{ author.name }}</b>
                                            </div>
                                            <div v-if="author.found && author.bio" v-html="author.bio" style="text-align: justify" />
                                            <div v-else-if="author.found" class="text-grey">Биография не найдена</div>
                                            <div v-else class="text-grey">Автор не найден в базе</div>
                                        </div>
                                    </div>
                                </div>
                                <div v-if="!authors.length" class="q-pa-md text-center text-grey">
                                    Авторы не найдены
                                </div>
                            </div>
                        </template>

                        <div class="q-mt-xs"></div>
                    </div>
                </div>
            </div>

            <div class="q-mt-md" v-html="annotation" />
        </div>

        <template #footer>
            <q-btn class="q-px-md q-ml-sm" color="primary" dense no-caps @click="okClick">
                OK
            </q-btn>
        </template>


        <Dialog v-model="posterDialogVisible">
            <template #header>
                <div class="row items-center">
                    <div style="font-size: 110%">
                        Обложка
                    </div>
                </div>
            </template>

            <img :src="coverSrc" class="fit q-pb-sm" style="height: 100%; max-height: calc(100vh - 140px); object-fit: contain" />
        </Dialog>
    </Dialog>
</template>

<script>
//-----------------------------------------------------------------------------
import vueComponent from '../../vueComponent.js';

import Dialog from '../../share/Dialog.vue';
import Fb2Parser from '../../../../server/core/fb2/Fb2Parser';
import * as utils from '../../../share/utils';
import _ from 'lodash';

const componentOptions = {
    components: {
        Dialog
    },
    watch: {
        modelValue(newValue) {
            this.dialogVisible = newValue;
            if (newValue)
                this.init();
        },
        dialogVisible(newValue) {
            this.$emit('update:modelValue', newValue);
        },
        selectedTab(newValue, oldValue) {
            if (newValue === 'reviews' && !this.reviewsLoaded && !this.reviewsLoading) {
                this.loadReviews();
            }
            if (newValue === 'authors' && !this.authorsLoaded && !this.authorsLoading) {
                this.loadAuthors();
            }
        },
    }
};
class BookInfoDialog {
    _options = componentOptions;
    _props = {
        modelValue: Boolean,
        bookInfo: Object,
        genreMap: Object,
    };

    dialogVisible = false;
    posterDialogVisible = false;
    selectedTab = 'fb2';

    //info props
    coverSrc = '';
    annotation = '';
    fb2 = [];
    book = {};

    //reviews
    reviewsLoading = false;
    reviewsError = '';
    reviews = {declaredCount: 0, sum: 0, foundCount: 0, reviews: []};
    reviewsLoaded = false;

    //authors
    authorsLoading = false;
    authorsError = '';
    authors = [];
    authorsLoaded = false;

    created() {
        this.commit = this.$store.commit;
    }

    get config() {
        return this.$store.state.config;
    }

    get api() {
        return this.$root.api;
    }

    mounted() {
    }

    init() {
        //defaults
        this.coverSrc = '';
        this.annotation = '';
        this.fb2 = [];
        this.book = {};

        //reviews
        this.reviewsLoading = false;
        this.reviewsError = '';
        this.reviews = {declaredCount: 0, sum: 0, foundCount: 0, reviews: []};
        this.reviewsLoaded = false;

        //authors
        this.authorsLoading = false;
        this.authorsError = '';
        this.authors = [];
        this.authorsLoaded = false;

        this.parseBookInfo();

        this.selectedTab = this.fb2.length ? 'fb2' : 'inpx';
    }

    get bookAuthor() {
        if (this.book.author) {
            let a = this.book.author.split(',');
            return a.slice(0, 3).join(', ') + (a.length > 3 ? ' и др.' : '');
        }

        return '';
    }

    get reviewsAvailable() {
        return this.config.reviewsEnabled && this.book._uid;
    }

    get authorsBioAvailable() {
        return this.config.authorsBioEnabled && this.book._uid;
    }

    get avgRating() {
        if (!this.reviews.declaredCount || !this.reviews.sum)
            return '';
        return (this.reviews.sum / this.reviews.declaredCount).toFixed(1);
    }

    get reviewsTabLabel() {
        if (this.reviewsLoaded && this.reviews.foundCount)
            return `Рецензии (${this.reviews.foundCount})`;
        return 'Рецензии';
    }

    get authorsTabLabel() {
        if (this.authorsLoaded && this.authors.length)
            return `Об авторе (${this.authors.length})`;
        return 'Об авторе';
    }

    formatSize(size) {
        size = size/1024;
        let unit = 'KB';
        if (size > 1024) {
            size = size/1024;
            unit = 'MB';
        }
        return `${size.toFixed(1)} ${unit}`;
    }

    convertGenres(genreArr) {
        let result = [];
        if (genreArr) {
            for (const genre of genreArr) {
                const g = genre.trim();
                const name = this.genreMap.get(g);
                result.push(name ? name : g);
            }
        }

        return result.join(', ');
    }

    get inpx() {
        const mapping = [
            {name: 'fileInfo', label: 'Информация о файле', value: [
                {name: 'folder', label: 'Папка'},
                {name: 'file', label: 'Файл'},
                {name: 'size', label: 'Размер'},
                {name: 'date', label: 'Добавлен'},
                {name: 'del', label: 'Удален'},
                {name: 'libid', label: 'LibId'},
                {name: 'insno', label: 'InsideNo'},
            ]},

            {name: 'titleInfo', label: 'Общая информация', value: [
                {name: 'author', label: 'Автор(ы)'},
                {name: 'title', label: 'Название'},
                {name: 'series', label: 'Серия'},
                {name: 'genre', label: 'Жанр'},
                {name: 'librate', label: 'Оценка'},
                {name: 'lang', label: 'Язык книги'},
                {name: 'keywords', label: 'Ключевые слова'},
            ]},
        ];

        const valueToString = (value, nodePath, b) => {//eslint-disable-line no-unused-vars
            if (nodePath == 'fileInfo/file')
                return `${value}.${b.ext}`;

            if (nodePath == 'fileInfo/size')
                return `${this.formatSize(value)} (${value.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1 ')} Bytes)`;

            if (nodePath == 'fileInfo/date')
                return utils.sqlDateFormat(value);

            if (nodePath == 'fileInfo/del')
                return (value ? 'Да' : null);

            if (nodePath == 'fileInfo/insno')
                return (value ? value : null);

            if (nodePath == 'titleInfo/author')
                return value.split(',').join(', ');

            if (nodePath == 'titleInfo/genre')
                return this.convertGenres(value.split(','));

            if (nodePath == 'titleInfo/librate' && !value)
                return null;

            if (typeof(value) === 'string') {
                return value;
            }

            return (value.toString ? value.toString() : '');
        };

        let result = [];
        const book = _.cloneDeep(this.book);
        book.series = [book.series, book.serno].filter(v => v).join(' #');

        for (const item of mapping) {
            const itemOut = {name: item.name, label: item.label, value: []};

            for (const subItem of item.value) {
                const subItemOut = {
                    name: subItem.name,
                    label: subItem.label,
                    value: valueToString(book[subItem.name], `${item.name}/${subItem.name}`, book)
                };
                if (subItemOut.value)
                    itemOut.value.push(subItemOut);
            }

            if (itemOut.value.length)
                result.push(itemOut);
        }

        return result;
    }

    get info() {
        let result = [];

        switch (this.selectedTab) {
            case 'fb2':
                return this.fb2;
            case 'inpx':
                return this.inpx;
        }

        return result;
    }

    parseBookInfo() {
        const bookInfo = this.bookInfo;

        //cover
        if (bookInfo.cover)
            this.coverSrc = bookInfo.cover;

        //fb2
        if (bookInfo.fb2) {
            const parser = new Fb2Parser(bookInfo.fb2);

            const infoObj = parser.bookInfo();

            if (infoObj.titleInfo) {
                let ann = infoObj.titleInfo.annotationHtml;
                if (ann) {
                    ann = ann.replace(/<p>/g, `<p class="p-annotation">`);
                    this.annotation = ann;
                }
            }

            const self = this;
            this.fb2 = parser.bookInfoList(infoObj, {
                valueToString(value, nodePath, origVTS) {//eslint-disable-line no-unused-vars
                    if (nodePath == 'documentInfo/historyHtml' && value)
                        return value.replace(/<p>/g, `<p class="p-history">`);

                    if ((nodePath == 'titleInfo/genre' || nodePath == 'srcTitleInfo/genre') && value) {
                        return self.convertGenres(value);
                    }

                    return origVTS(value, nodePath);
                },
            });
        }

        //book
        if (bookInfo.book)
            this.book = bookInfo.book;
    }

    posterClick() {
        if (!this.coverSrc)
            return;

        this.posterDialogVisible = true;
    }

    authorPhotoUrl(hash) {
        const root = this.config.rootPathStatic || '';
        return `${root}/author/photo?hash=${encodeURIComponent(hash)}`;
    }

    async loadReviews() {
        if (this.reviewsLoading || this.reviewsLoaded)
            return;

        this.reviewsLoading = true;
        this.reviewsError = '';

        try {
            const result = await this.api.getBookReviews(this.book._uid);
            this.reviews = result;
            this.reviewsLoaded = true;
        } catch (e) {
            this.reviewsError = e.message;
        } finally {
            this.reviewsLoading = false;
        }
    }

    async loadAuthors() {
        if (this.authorsLoading || this.authorsLoaded)
            return;

        this.authorsLoading = true;
        this.authorsError = '';

        try {
            const res = await this.api.getBookAuthors(this.book._uid);
            const list = res.authors || [];

            // догружаем биографии последовательно
            const result = [];
            for (const a of list) {
                let bio = null;
                if (a.found) {
                    try {
                        const bioRes = await this.api.getAuthorBio(a.hash);
                        bio = bioRes.bio;
                    } catch (e) {
                        bio = null;
                    }
                }
                result.push(Object.assign({}, a, {bio}));
            }

            this.authors = result;
            this.authorsLoaded = true;
        } catch (e) {
            this.authorsError = e.message;
        } finally {
            this.authorsLoading = false;
        }
    }

    okClick() {
        this.dialogVisible = false;
    }
}

export default vueComponent(BookInfoDialog);
//-----------------------------------------------------------------------------
</script>

<style scoped>
.poster-size {
    height: 300px;
    width: 200px;
    min-width: 100px;
}

.poster, .no-poster {
    width: 100%;
    height: 100%;
}

.poster:hover {
    position: relative;
    top: -1%;
    left: -1%;
    width: 102%;
    height: 102%;
    cursor: pointer;
}

</style>

<style>
.p-annotation {
    text-indent: 20px;
    text-align: justify;
    padding: 0;
    margin: 0;
}

.p-history {
    padding: 0;
    margin: 0;
}
</style>