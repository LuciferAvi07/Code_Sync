import React from 'react';
import Avatar from 'react-avatar';

const avatarColors = ['#19c98b', '#2d9cdb', '#8e5bb7', '#e07a5f', '#4f9d69', '#d39e4a'];

function getAvatarColor(username) {
    // react-avatar crashes on an empty name, and `[...''].reduce` returns 0
    // without throwing — the failure was one refactor away from a white screen.
    const label = String(username || '').trim() || '?';
    const colorIndex = [...label].reduce(
        (total, character) => total + character.charCodeAt(0),
        0
    );
    return avatarColors[colorIndex % avatarColors.length];
}

const Client = ({ username, isSelf = false }) => {
    const label = String(username || '').trim() || 'Anonymous';
    return (
        <div className="client">
            <Avatar
                name={label}
                size="34"
                round="11px"
                color={getAvatarColor(username)}
            />
            <div className="vs-client-details">
                <span className="userName" title={label}>{label}{isSelf && <span className="vs-self-badge">you</span>}</span>
                <span className="vs-client-description">{isSelf ? 'Your workspace' : 'Collaborating live'}</span>
            </div>
            <span className="vs-presence-dot is-online" title="Online" />
        </div>
    );
};

export default Client;
