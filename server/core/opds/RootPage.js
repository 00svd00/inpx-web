const BasePage = require('./BasePage');
const AuthorPage = require('./AuthorPage');
const SeriesPage = require('./SeriesPage');
const TitlePage = require('./TitlePage');
const GenrePage = require('./GenrePage');
const FavoritesPage = require('./FavoritesPage');
const CustomOpdsFeedPage = require('./CustomOpdsFeedPage');

class RootPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'root';
        this.title = '';

        this.authorPage = new AuthorPage(config);
        this.seriesPage = new SeriesPage(config);
        this.titlePage = new TitlePage(config);
        this.genrePage = new GenrePage(config);
        this.favoritesPage = new FavoritesPage(config);
    }

    async body(req) {
        const result = {};

        if (!this.title) {
            const dbConfig = await this.webWorker.dbConfig();
            const collection = dbConfig.inpxInfo.collection.split('\n');
            this.title = collection[0].trim();
            if (!this.title)
                this.title = 'Неизвестная коллекция';
        }

        result.entry = [
            this.authorPage.myEntry(),
            this.seriesPage.myEntry(),
            this.titlePage.myEntry(),
            this.genrePage.myEntry(),
            this.favoritesPage.myEntry(),
        ];

        // кастомные OPDS-фиды
        const feeds = await CustomOpdsFeedPage.loadCustomFeeds(this.config);
        for (const feed of Object.values(feeds)) {
            if (!feed.active)
                continue;
            result.entry.push(this.makeEntry({
                id: `custom-${feed.id}`,
                title: feed.name || feed.id,
                link: this.navLink({href: `/custom/${feed.id}`}),
            }));
        }

        return this.makeBody(result, req);
    }
}

module.exports = RootPage;