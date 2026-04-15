#pragma once

#include <vector>
#include <string>

struct CrdtItem{
    std::string id;
    std::vector<int> fractionalPosition;
    std::string userId;
    long long timestamp;
    std::string shapeData;

    bool operator<(const CrdtItem& other) const{
        if( this->fractionalPosition != other.fractionalPosition ){
            return this->fractionalPosition < other.fractionalPosition;
        }

        if( this->userId != other.userId ){
            return this->userId < other.userId;
        }

        return this->id < other.id;
    }
};