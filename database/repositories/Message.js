const queryEx = require('../query');
const parser = require('../parser');
const Message = require('../models/Message');

const type = 'message';

parser.setSingle(type, function(record){
    return parseOneRecord(record);
});

parser.setMerges(type, ['files']);

function parseOneRecord(record){
    let node = record.get('m');

    let params = {
        conv    : record.get('c'),
        sender  : record.get('u'),
        own     : record.get('o'),
    };

    if (record.has('_f')){
        let files = record.get('_f');
        if (files){
            if (files.properties){
                files = [files];
            }

            params.files = files;
        }
    }

    let entity = new Message(node, params);
    return entity;
}

let MessageRepository = {

    createOne               : function(message, senderId, convId, filesId){
        return new Promise((resolve, reject) => {

            this.resetLastProp(convId)
            .then(result => {

                let query = `
                    MERGE (id:UniqueId {name:'${type}'})
                    ON CREATE SET id.count = 1
                    ON MATCH SET id.count = id.count + 1

                    WITH id.count AS uid
                    MATCH (u:User {uid:${senderId}})-[ma:MEMBERS]->(c:Conversation {uid:${convId}})
                    CREATE (c)-[o:OWN $own]->(m:Message $message)-[f:FROM]->(u)
                    SET m.uid = uid
                    RETURN m, u, c, o
                `;

                let params = {
                    message : {
                        value       : message,
                        date        : (new Date()).getTime(),
                    },
                    own     : {last : true}
                };

                queryEx.exec(query, params)
                .then(results => {
                    results = (parser.records(results, type, true));

                    if (filesId && filesId.length > 0){
                        results.files = filesId;
                        
                        let filesQuery = `
                            MATCH (m:Message {uid:${results._id}})
                            CREATE 
                        `;

                        for (let i in filesId){
                            if (i > 0){
                                filesQuery += ', '; 
                            }
                            filesQuery += `(m)-[tf${i}:TMP]->(_f${i}:TmpFile {id:"${filesId[i]}"})`
                        }

                        queryEx.exec(filesQuery)
                        .then(response => {
                            return resolve(results);
                        });
                    } else {
                        return resolve(results);
                    }
                }).catch(err => {
                    return reject(err);
                });
            }, function(err){
                return reject(err);
            });
        });
    },

    resetLastProp           : function(convId){
        return new Promise((resolve, reject) => {

            let query = `
                MATCH (c:Conversation {uid:${convId}})-[o:OWN]->(om:Message)
                SET o.last = NULL AND o.readBy = NULL
            `;

            queryEx.exec(query)
            .then(results => {
                return resolve(parser.records(results, type));
            }).catch(err => {
                return reject(err);
            });
        });
    },

    findByConversation      : function(conv, limit, skip){

        let convId = (typeof conv === 'object')? conv._id : conv;

        return new Promise((resolve, reject) => {

            let query = `
                MATCH (c:Conversation {uid:${convId}})-[o:OWN]->(m:Message)-[f:FROM]->(u:User)
                OPTIONAL MATCH (_f:File)-[b:BELONG_TO]->(m)<-[o]-(c)
                RETURN c, m, o, u, _f
                ORDER BY m.date DESC
            `;

            if (limit){
                skip = skip || 0;
                query += `SKIP ${skip} LIMIT ${limit}`;
            }

            queryEx.exec(query)
            .then(results => {
                return resolve(parser.records(results, type));
            }).catch(err => {
                return reject(err);
            });
        });
    },

    findLastMessageByConversations : function(convs){
        let ids = [];
        for (var i in convs){
            ids.push(convs[i]._id);
        }

        return new Promise((resolve, reject) => {

            let query = `
                MATCH (c)-[o:OWN]->(m:Message)-[f:FROM]->(u:User)
                WHERE c.uid IN [${ids.join(', ')}] AND o.last = TRUE
                OPTIONAL MATCH (_f:File)-[b:BELONG_TO]->(m)<-[o]-(c)
                RETURN m, c, o, u, _f
            `;

            queryEx.exec(query)
            .then(results => {
                return resolve(parser.records(results, type));
            }).catch(err => {
                return reject(err);
            });
        });
    },

    updateOneMessageFiles   : function(file, convId) {
        return new Promise((resolve, reject) => {

            let query = `
                MATCH (c:Conversation {uid:${convId}})-[o:OWN]->(m:Message)-->(f:TmpFile), (m)-->(u:User), (_f:File {uid:${file._id}})
                WHERE f.id="${file.id}"
                CREATE (_f)-[b:BELONG_TO]->(m)
                DETACH DELETE f
                RETURN m, c, o, u, _f;
            `;

            queryEx.exec(query)
            .then(results => {
                return resolve(parser.records(results, type, true));
            }).catch(err => {
                return reject(err);
            });
        });
    }

};

module.exports = MessageRepository;