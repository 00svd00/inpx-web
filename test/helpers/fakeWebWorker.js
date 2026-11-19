// Настраиваемый фейк WebWorker для OPDS-тестов.
// Все методы — счётчики вызовов; поведение задаётся в opts.
function makeFakeWebWorker(opts = {}) {
    const calls = {
        getBookReviewsCount: 0,
        getBookAuthors: 0,
        getBookInfo: 0,
        getBookRecord: 0, 
        getBooks: 0,
        getGenreMap: 0,
        getGenreTree: 0,
        getBookReviews: 0,
        getAuthorBio: 0,
        getAuthorPhoto: 0,
    };

    const ww = {
        calls,
        async getBookReviewsCount(uid) {
            calls.getBookReviewsCount++;
            if (opts.getBookReviewsCount) return opts.getBookReviewsCount(uid);
            return {declaredCount: 0, sum: 0};
        },
        async getBookAuthors(uid) {
            calls.getBookAuthors++;
            if (opts.getBookAuthors) return opts.getBookAuthors(uid);
            return [];
        },
        async getBookInfo(uid) {
            calls.getBookInfo++;
            if (opts.getBookInfo) return opts.getBookInfo(uid);
            return {bookInfo: null};
        },
        async getBookRecord(uid) {
            calls.getBookRecord = (calls.getBookRecord || 0) + 1;
            if (opts.getBookRecord) return opts.getBookRecord(uid);
            return {
                _uid: uid,
                title: 'T',
                author: 'A',
                series: 'S',
                serno: 1,
                ext: 'fb2',
            };
        },
        async getBooks(uids) {
            calls.getBooks = (calls.getBooks || 0) + 1;
            if (opts.getBooks) return opts.getBooks(uids);
            return [];
        },
        async getGenreMap() {
            calls.getGenreMap++;
            if (opts.getGenreMap) return opts.getGenreMap();
            return new Map();
        },
        async getGenreTree() {
            calls.getGenreTree++;
            if (opts.getGenreTree) return opts.getGenreTree();
            return {genreTree: [], langList: [], extList: [], inpxHash: ''};
        },
        async getBookReviews(uid) {
            calls.getBookReviews++;
            if (opts.getBookReviews) return opts.getBookReviews(uid);
            return {reviews: [], declaredCount: 0, sum: 0, months: []};
        },
        async getAuthorBio(hash) {
            calls.getAuthorBio++;
            if (opts.getAuthorBio) return opts.getAuthorBio(hash);
            return null;
        },
        async getAuthorPhoto(hash) {
            calls.getAuthorPhoto++;
            if (opts.getAuthorPhoto) return opts.getAuthorPhoto(hash);
            return null;
        },
    };

    return ww;
}

module.exports = { makeFakeWebWorker };