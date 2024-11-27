
import { privateRequest } from '../utils/api';
import React, { useEffect, useState } from 'react';
import { Goal } from '../types';


const List: React.FC = () => {
    const [list, setList] = useState<Goal[]>([]);

    useEffect(() => {
        privateRequest<Goal[]>('list').then(setList);
    }, []);

    return <div>List</div>;
};

export default List;