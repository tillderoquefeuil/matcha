const socket_io = require('socket.io');

const account = require('./account/lib.js');
const chat = require('./chat/lib.js');
const Files = require('./utils/files.js');

const clients = {};

function getUserBySocket(socket){
    let token = socket.handshake.query._token;

    if (clients[token]){
        return clients[token].user;
    }

    return null;
}

const rooms = {

    // GENERIC

    getRoomName : function(base, id){
        return base + '_' + id;
    },

    joinRoom        : function(socket, roomName){
        socket.join(roomName);
    },

    leaveRoom       : function(socket, roomName){
        socket.leave(roomName);
    },

    // SPECIFIC

    getOnlineRoom   : function(userId){
        return this.getRoomName('online', userId);
    },
    
    getOnchatRoom   : function(userId){
        return this.getRoomName('onchat', userId);
    },

    getChatRoom     : function(convId){
        return this.getRoomName('conversation', convId);
    },

    getUnreadsRoom     : function(convId){
        return this.getRoomName('unread', convId);
    },

    joinUnreadsRoom  : function(socket, userId){
        let roomName = this.getUnreadsRoom(userId)
        this.joinRoom(socket, roomName);
    },

    joinOnlineRoom  : function(socket, userId){
        let roomName = this.getOnlineRoom(userId)
        this.joinRoom(socket, roomName);
    },

    joinOnchatRoom  : function(socket, userId){
        let roomName = this.getOnchatRoom(userId)
        this.joinRoom(socket, roomName);
    },

    joinChatRoom  : function(socket, convId){
        let roomName = this.getChatRoom(convId)
        this.joinRoom(socket, roomName);
    }

};

const chatHelpers = {

    sendUnreads : function(io, userId) {
        let userRoom = rooms.getUnreadsRoom(userId);

        chat.getUnreadConversations(userId)
        .then(results => {
            io.sockets.in(userRoom).emit('UNREAD_CHATS', {unreads : results});
        });
    }

};


module.exports = function (app, server) {

    let io = socket_io(server, {
        pingTimeout : 60000
    });

    io.use((socket, next) => {
        let token = socket.handshake.query._token;

        account.getUserFromToken(token)
        .then(user => {
            if (user){
                clients[token] = {
                    socket  : socket,
                    user    : user
                };
            }
            return next();
        }).catch(err => {
            return next();
        });

    });

    io.sockets.on('connection', function (socket) {

        socket.on('ONLINE', function(data){
            let user = getUserBySocket(socket);

            rooms.joinOnlineRoom(socket, user._id);
            account.setOnlineUser(user);
        });

        socket.on("disconnect", function(){
            let user = getUserBySocket(socket);

            if (user && user._id){
                account.setOfflineUser(user);
            }
        });

        // CHAT

        socket.on('UNREAD_CHATS', function(data){
            let user = getUserBySocket(socket);
            if (!user){
                return;
            }
            rooms.joinUnreadsRoom(socket, user._id);

            chatHelpers.sendUnreads(io, user._id);
        });

        socket.on('ON_CHAT', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnchatRoom(user._id);
            rooms.joinRoom(socket, userRoom);

            //LOAD CONTACTS
            account.loadContacts(user)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_CONTACTS', results);
            });

            //LOAD CONVERSATIONS
            chat.loadConversations(user._id)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_CONVERSATIONS', results);
            });
        });

        socket.on('GET_CONTACTS', function(data){
            let user = getUserBySocket(socket);
            
            let userRoom = rooms.getOnchatRoom(user._id);
            
            //LOAD CONTACTS
            account.loadContacts(user)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_CONTACTS', results);
            });

        });

        socket.on('SELECT_ONE_CHAT', function(data){
            let user = getUserBySocket(socket);

            chat.loadOneConversationByUsers([user._id, data.partner_id])
            .then(results => {
                let userChatRoom = rooms.getOnchatRoom(user._id);
                
                let label = 'CHAT_SELECTED';
                label += (data.status === 'footer_chat')? '_FOOTER' : '';
                results.force = data.force;

                io.sockets.in(userChatRoom).emit('CHAT_UPDATE', results);
                io.sockets.in(userChatRoom).emit(label, results);
            });
        });

        socket.on('JOIN_ONE_CHAT', function(data){
            let user = getUserBySocket(socket);

            let convRoom = rooms.getChatRoom(data.conv_id);
            rooms.joinRoom(socket, convRoom);

            let userRoom = rooms.getOnchatRoom(user._id);
            chat.loadMessages(data.conv_id, data.items)
            .then(results => {
                results.conv_id = data.conv_id;
                results.items = data.items;
                io.sockets.in(userRoom).emit('LOAD_MESSAGES', results);
            }).catch(e => {
                console.log(e);
            });
        });

        socket.on('LEAVE_ONE_CHAT', function(data){
            let convRoom = rooms.getChatRoom(data.conv_id);
            rooms.leaveRoom(socket, convRoom);
        });

        socket.on('USER_READ_CHAT', function(data){
            let user = getUserBySocket(socket);

            if (!data.conv_id){
                return;
            }

            chat.updateOneConversation(data.conv_id, user._id)
            .then(results => {

                let userChatRoom = rooms.getOnchatRoom(user._id);
                io.sockets.in(userChatRoom).emit('CHAT_UPDATE', results);

                // FOR USER NOTIF
                chatHelpers.sendUnreads(io, user._id);
            });
        });

        socket.on('SEND_MESSAGE', function(data){
            let user = getUserBySocket(socket);

            chat.createOneMessage(data, user)
            .then(message => {

                // MESSAGE CREATED
                let chatName = rooms.getChatRoom(data.conv_id);
                io.sockets.in(chatName).emit('NEW_MESSAGE', {message : message});

                // UPDATE CONVERSATION
                chat.loadOneConversation(data.conv_id, user._id)
                .then(results => {

                    let partnerId = results.conv.getPartnerId(user._id);

                    let emitLabel = 'CHAT_UPDATE';

                    // FOR USER CHAT
                    let userChatRoom = rooms.getOnchatRoom(user._id);
                    io.sockets.in(userChatRoom).emit(emitLabel, results);

                    // FOR PARTNER CHAT
                    let partnerChatRoom = rooms.getOnchatRoom(partnerId);
                    io.sockets.in(partnerChatRoom).emit(emitLabel, results);

                    // FOR PARTNER NOTIF
                    chatHelpers.sendUnreads(io, partnerId);
                });

            }).catch(err =>{
                console.log(err);
            });
        });

        // FILES

        socket.on('FILE_SLICE_UPLOAD', function(data){
            let user = getUserBySocket(socket);

            let onlineRoom = rooms.getOnlineRoom(user._id);
            let upload = Files.uploadFile(data, user);

            if (upload.end !== true) {
                // ASK FOR NEXT SLICE
                io.sockets.in(onlineRoom).emit('UPLOAD_NEXT_SLICE', upload.file);
            } else {
                switch (data.file_case){
                    case 'chat':
                        let convId = data.conv_id;

                        chat.uploadFile(convId, upload, user)
                        .then(results => {
                            // MESSAGE UPDATE
                            let convRoom = rooms.getChatRoom(convId);
                            io.sockets.in(convRoom).emit('MESSAGE_FILE_UPDATE', {message : results.message});
                        });
                        break;
                    case 'user_pictures':
                        account.updateUserPicture(user, upload, data)
                        .then(_user => {
                            io.sockets.in(onlineRoom).emit('USER_PICTURE_UPDATE', {user : _user});
                        });
                        break;
                }
            }
        });

        socket.on('UPDATE_MAIN_PICTURE', function(data){
            let user = getUserBySocket(socket);
            let onlineRoom = rooms.getOnlineRoom(user._id);

            account.updateMainPicture(user, data.main_id)
            .then(_user => {
                io.sockets.in(onlineRoom).emit('END_USER_PICTURE_UPDATE', {user : _user});
                io.sockets.in(onlineRoom).emit('PROFILE_PICTURE_UPDATE', {user : _user});
            });
        });
        
        socket.on('DELETE_FILES', function(data){
            let user = getUserBySocket(socket);
            let onlineRoom = rooms.getOnlineRoom(user._id);

            account.deleteFiles(user, data.files_ids)
            .then(results => {
                io.sockets.in(onlineRoom).emit('USER_DELETE_FILES');
            });
        });

        //SEARCH PARAMS

        socket.on('GET_SEARCH_PARAMS', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            rooms.joinRoom(socket, userRoom);

            //LOAD CONTACTS
            account.loadSearchParams(user)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_SEARCH_PARAMS', results);
            });
        });

        socket.on('SET_SEARCH_PARAMS', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            rooms.joinRoom(socket, userRoom);

            account.updateSearchParams(user, data)
            .then(results => {
                io.sockets.in(userRoom).emit('UPDATE_SEARCH_PARAMS', results);
            });
        });


        //MATCHES

        socket.on('GET_MATCHES', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            rooms.joinRoom(socket, userRoom);

            //LOAD CONTACTS
            let options = data? data.options : {};
            account.loadMatches(user, options)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_MATCHES', results);
            });
        });

        socket.on('GET_MATCHED', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            rooms.joinRoom(socket, userRoom);

            //LOAD CONTACTS
            account.loadMatchedProfiles(user)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_MATCHED', results);
            });
        });

        socket.on('GET_EXTENDED_PROFILE', function(data){
            let user = getUserBySocket(socket);
            let userRoom = rooms.getOnlineRoom(user._id);

            account.loadOneMatch(user, data.partner_id)
            .then(results => {
                results.contact = data.contact;
                results.disabled = data.disabled;
                io.sockets.in(userRoom).emit('LOAD_EXTENDED_PROFILE', results);
            });
        });

        socket.on('ADD_MATCH_VISIT', function(data){
            let user = getUserBySocket(socket);

            if (data.partner_id === user._id){
                return;
            }

            let userRoom = rooms.getOnlineRoom(user._id);
            let partnerRoom = rooms.getOnlineRoom(data.partner_id);

            account.addVisit(user, data)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_ONE_VISIT', {visit : results.visit});
                io.sockets.in(partnerRoom).emit('NEW_EVENT', {event : results.event});
            });
        });

        socket.on('GET_USER_VISITS', function(data){
            let user = getUserBySocket(socket);
            let userRoom = rooms.getOnlineRoom(user._id);

            account.getAllVisits(user)
            .then(resutls => {
                io.sockets.in(userRoom).emit('LOAD_USER_VISITS', resutls);
            });
        });

        socket.on('UPDATE_MATCH_RELATION', function(data){
            let user = getUserBySocket(socket);
            let userRoom = rooms.getOnlineRoom(user._id);

            if (data.partner_id === user._id){
                return;
            }

            account.mergeMatchRelation(user, data)
            .then(partner => {
                io.sockets.in(userRoom).emit('LOAD_ONE_MATCH', {match:partner});
                io.sockets.in(userRoom).emit('UPDATE_ONE_MATCH', {match:partner});
            });
        });

        socket.on('UPDATE_LIKE_STATE', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            let partnerRoom = rooms.getOnlineRoom(data.partner_id);

            account.updateLike(user, data)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_ONE_MATCH', {match:results.partner});
                io.sockets.in(userRoom).emit('UPDATE_ONE_MATCH', {match:results.partner});

                io.sockets.in(partnerRoom).emit('NEW_EVENT', {event : results.p_event});
                if (results.u_event){
                    io.sockets.in(userRoom).emit('NEW_EVENT', {event : results.u_event});
                }
            });
        });

        socket.on('BLOCK_MATCH_RELATION', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            let partnerRoom = rooms.getOnlineRoom(data.partner_id);

            account.blockMatchRelation(user, data)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_ONE_MATCH', {match:data.partner_id});
                io.sockets.in(userRoom).emit('DELETE_ONE_MATCH', {match:data.partner_id});
                io.sockets.in(partnerRoom).emit('NEW_EVENT', {event : results.event});
            });
        });

        socket.on('REPORT_MATCH_RELATION', function(data){
            let user = getUserBySocket(socket);

            let userRoom = rooms.getOnlineRoom(user._id);
            let partnerRoom = rooms.getOnlineRoom(data.partner_id);

            account.reportMatchRelation(user, data)
            .then(results => {
                io.sockets.in(userRoom).emit('LOAD_ONE_MATCH', {match:data.partner_id});
                io.sockets.in(userRoom).emit('DELETE_ONE_MATCH', {match:data.partner_id});
                io.sockets.in(partnerRoom).emit('NEW_EVENT', {event : results.event});
            });
        });

        //NOTIFICATIONS

        socket.on('GET_USER_EVENTS', function(data){
            let user = getUserBySocket(socket);
            let userRoom = rooms.getOnlineRoom(user._id);
            let all = data? data.all : false;

            //LOAD EVENTS
            account.loadUserEvents(user, all)
            .then(events => {
                io.sockets.in(userRoom).emit('LOAD_USER_EVENTS', {events:events});
            });
        });

        socket.on('USER_READ_EVENTS', function(data){
            let user = getUserBySocket(socket);
            let userRoom = rooms.getOnlineRoom(user._id);
            let all = data? data.all : false;

            //LOAD EVENTS
            account.userEventsRead(user, all)
            .then(events => {
                io.sockets.in(userRoom).emit('LOAD_USER_EVENTS', {events:events});
            });
        });


    });
}