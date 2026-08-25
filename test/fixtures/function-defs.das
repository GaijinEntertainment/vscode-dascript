def private static submit_message(clientNode : NodeId; inputFieldNode : NodeId) {
    get_component(clientNode) $(var c : ChatClient?) {
        if (c == null) {
            return
        }
        get_component(inputFieldNode) $(var ti : UITextInput?) {
            if (ti != null && !empty(ti.text)) {
                c->send_chat_message(ti.text)
                ti.text = ""
                ti.invalidate()
            }
        }
    }
}

def public override abstract tick : int

struct Player
    def const operator . controlledByLocalPlayer() {
        return controlledByConnectionId == LOCAL_CONNECTION_ID
    }
