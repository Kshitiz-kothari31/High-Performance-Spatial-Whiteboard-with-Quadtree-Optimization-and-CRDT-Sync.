#ifndef FRACTIONAL_INDEXER_H
#define FRACTIONAL_INDEXER_H

#include <vector>
#include <string>

class FractionalIndexer{
    public:
        static std::vector<int> generateIntermediate(const std::vector<int>& p1, const std::vector<int> &p2){
            std::vector<int> result;
            int i = 0;

            const int BASE = 100;

            while(true){
                int v1 = (i < p1.size()) ? p1[i] : 0;
                int v2 = (i < p2.size()) ? p2[i] : BASE;

                if(v2 - v1 > 1){
                    result.push_back(v1 + (v2 - v1)/2);
                    break;
                }else{
                    result.push_back(v1);
                    i++;
                }
            }

            return result;
        }
};

#endif