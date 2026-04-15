#include <iostream>
#include <list>
#include <string>
#include <vector>
#include <algorithm>
#include <sstream>

#include "CrdtItem.cpp" 
#include "fractionalIndexer.h"

#include <emscripten/bind.h>

using namespace emscripten;

class WhiteboardManager {
    private:
        std::list<CrdtItem> elements;

    public:
        WhiteboardManager() {}

        void addElement(std::string id, std::vector<int> pos, std::string uid, std::string data) {
            // Upsert: Remove existing element with same ID if present
            auto it = elements.begin();
            while (it != elements.end()) {
                if (it->id == id) {
                    it = elements.erase(it);
                } else {
                    ++it;
                }
            }

            CrdtItem newItem;
            newItem.id = id;
            newItem.fractionalPosition = pos;
            newItem.userId = uid;
            newItem.shapeData = data;
            newItem.timestamp = 0;

            auto insertIt = std::lower_bound(elements.begin(), elements.end(), newItem);
            elements.insert(insertIt, newItem);
        }

        void deleteElement(std::string id) {
            auto it = elements.begin();
            while (it != elements.end()) {
                if (it->id == id) {
                    it = elements.erase(it);
                    break; 
                } else {
                    ++it;
                }
            }
        }

        std::vector<int> generateIntermediate(std::vector<int> p1, std::vector<int> p2) {
            return FractionalIndexer::generateIntermediate(p1, p2);
        }

        std::string getOrderedElements() {
            std::stringstream ss;
            ss << "[";
            for (auto it = elements.begin(); it != elements.end(); ++it) {
                ss << it->shapeData;
                if (std::next(it) != elements.end()) {
                    ss << ",";
                }
            }
            ss << "]";
            return ss.str();
        }

        void clearBoard() {
            elements.clear();
        }

        int getElementCount() {
            return (int)elements.size();
        }
    };

// --- Emscripten Bindings ---
EMSCRIPTEN_BINDINGS(whiteboard_module) {
    emscripten::register_vector<int>("VectorInt");

    emscripten::class_<WhiteboardManager>("WhiteboardManager")
        .constructor<>()
        .function("addElement", &WhiteboardManager::addElement)
        .function("deleteElement", &WhiteboardManager::deleteElement)
        .function("generateIntermediate", &WhiteboardManager::generateIntermediate)
        .function("getOrderedElements", &WhiteboardManager::getOrderedElements)
        .function("clearBoard", &WhiteboardManager::clearBoard)
        .function("getElementCount", &WhiteboardManager::getElementCount);
}