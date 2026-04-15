export class VectorInt {
    constructor() {
        this.data = [];
    }
    push_back(val) {
        this.data.push(val);
    }
    delete() {
        this.data = [];
    }
    size() {
        return this.data.length;
    }
    get(i) {
        return this.data[i];
    }
}

export class FractionalIndexer {
    static generateIntermediate(p1 = [], p2 = []) {
        const result = [];
        let i = 0;
        const BASE = 100;

        while (true) {
            const v1 = i < p1.length ? p1[i] : 0;
            const v2 = i < p2.length ? p2[i] : BASE;

            if (v2 - v1 > 1) {
                result.push(v1 + Math.floor((v2 - v1) / 2));
                break;
            } else {
                result.push(v1);
                i++;
            }
        }

        return result;
    }
}

export class WhiteboardManager {
    constructor() {
        this.elements = [];
    }

    addElement(id, vectorPos, uid, dataStr) {
        const pos = vectorPos.data;
        
        // Upsert: Remove existing element with same ID if present
        this.elements = this.elements.filter(el => el.id !== id);

        const newItem = {
            id,
            fractionalPosition: pos,
            userId: uid,
            shapeData: JSON.parse(dataStr),
            timestamp: 0
        };

        // Find insert position (lower_bound equivalent)
        const insertIt = this.elements.findIndex(el => this._compare(newItem, el) < 0);
        
        if (insertIt === -1) {
            this.elements.push(newItem);
        } else {
            this.elements.splice(insertIt, 0, newItem);
        }
    }

    deleteElement(id) {
        this.elements = this.elements.filter(el => el.id !== id);
    }

    generateIntermediate(v1, v2) {
        const p1 = v1.data || [];
        const p2 = v2.data || [];
        const resultArr = FractionalIndexer.generateIntermediate(p1, p2);
        
        const result = new VectorInt();
        result.data = resultArr;
        return result;
    }

    getOrderedElements() {
        return JSON.stringify(this.elements.map(el => el.shapeData));
    }

    clearBoard() {
        this.elements = [];
    }

    getElementCount() {
        return this.elements.length;
    }

    _compare(a, b) {
        // 1. Fractional position
        const maxLen = Math.max(a.fractionalPosition.length, b.fractionalPosition.length);
        for (let i = 0; i < maxLen; i++) {
            const v1 = i < a.fractionalPosition.length ? a.fractionalPosition[i] : 0;
            const v2 = i < b.fractionalPosition.length ? b.fractionalPosition[i] : 0;
            if (v1 !== v2) {
                return v1 - v2; // < 0 if a < b
            }
        }

        // 2. User ID
        if (a.userId !== b.userId) {
            return a.userId < b.userId ? -1 : 1;
        }

        // 3. Item ID
        if (a.id !== b.id) {
             return a.id < b.id ? -1 : 1;
        }

        return 0;
    }
}
