#include "Database.h"

#include <stdexcept>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

jsi::Runtime &Database::getRt() {
    if (runtime_ == nullptr) {
        throw std::runtime_error("JSI runtime is not available");
    }
    return *runtime_;
}

std::string Database::sqliteErrorMessage(std::string description) {
    auto sqliteMessage = std::string(sqlite3_errmsg(db_->sqlite));
    auto code = sqlite3_extended_errcode(db_->sqlite);
    auto message = description + " - sqlite error " + std::to_string(code) + " (" + sqliteMessage + ")";
    consoleError(message);
    return message;
}

void Database::throwSqliteError(std::string description) {
    throw std::runtime_error(sqliteErrorMessage(std::move(description)));
}

jsi::JSError Database::dbError(std::string description) {
    return jsi::JSError(getRt(), sqliteErrorMessage(std::move(description)));
}

jsi::Array Database::arrayFromStd(std::vector<jsi::Value> &vector) {
    // FIXME: Adding directly to a jsi::Array should be more efficient, but Hermes does not support
    // automatically resizing an Array by setting new values to it
    auto &rt = getRt();
    jsi::Array array(rt, vector.size());
    size_t i = 0;
    for (auto const &value : vector) {
        array.setValueAtIndex(rt, i, value);
        i++;
    }
    return array;
}

} // namespace watermelondb
