import React from 'react';
import Avatar from 'react-avatar';

const avatarColors = ['#19c98b', '#2d9cdb', '#8e5bb7', '#e07a5f', '#4f9d69', '#d39e4a'];

function getAvatarColor(username) {
    const colorIndex = [...username].reduce(
        (total, character) => total + character.charCodeAt(0),
        0
    );
    return avatarColors[colorIndex % avatarColors.length];
}

const Client = ({ username }) => {
    return (
        <div className="client">
            <Avatar
                name={username}
                size="50"
                round="14px"
                color={getAvatarColor(username)}
            />
            <span className="userName">{username}</span>
        </div>
    );
};

export default Client;
