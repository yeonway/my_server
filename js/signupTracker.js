class SignupTracker {
    constructor() {
        this.dbName = 'UserRegistrationDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('signups')) {
                    const store = db.createObjectStore('signups', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('username', 'username', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async recordSignup(username) {
        if (!this.db) await this.init();

        const transaction = this.db.transaction(['signups'], 'readwrite');
        const store = transaction.objectStore('signups');

        const signupRecord = {
            username: username,
            timestamp: Date.now(),
            date: new Date().toISOString(),
            userAgent: navigator.userAgent,
            language: navigator.language
        };

        return new Promise((resolve, reject) => {
            const request = store.add(signupRecord);
            request.onsuccess = () => resolve(signupRecord);
            request.onerror = () => reject(request.error);
        });
    }

    async getSignupHistory() {
        if (!this.db) await this.init();

        const transaction = this.db.transaction(['signups'], 'readonly');
        const store = transaction.objectStore('signups');

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async hasRecentSignup(hours = 24) {
        const history = await this.getSignupHistory();
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        
        return history.filter(record => record.timestamp > cutoff);
    }

    async clearHistory() {
        if (!this.db) await this.init();

        const transaction = this.db.transaction(['signups'], 'readwrite');
        const store = transaction.objectStore('signups');

        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// 전역 인스턴스
const signupTracker = new SignupTracker();